import "../guard";
import * as z from "zod";
import { Prisma, type ClaudeConnection } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { rateLimit } from "../ratelimit";
import { leadAllowance } from "../billing";
import { LEAD_STATUSES } from "../../constants";
import { appUrl, authenticateToken, touchConnection } from "./connections";
import { claimTask, completeTask, isGloballyPaused, PERMISSIONS, reportError, reportProgress, shortId, taskBrief, taskForWrite } from "./tasks";
import { BusinessItem, ContactItem, createEmailDraft, FactItem, leadProfile, searchLeads, submitBusinesses, submitContacts, submitFacts } from "./results";

/**
 * WebScout's MCP server (Streamable HTTP, stateless JSON responses). Claude reaches it as a custom
 * connector (https://<app>/api/mcp/<token>) or through the WebScout desktop extension. The secret
 * token identifies the workspace; every tool is limited to that workspace.
 */
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const FALLBACK_VERSION = "2025-06-18";
const SERVER_INFO = { name: "webscout-ai", title: "WebScout AI", version: "1.0.0" };
const INSTRUCTIONS = [
  "WebScout AI is the user's prospecting CRM for their web agency.",
  "When the user asks you to run, start or continue their WebScout task, call get_next_task and follow the brief it returns exactly.",
  "Report results as you go with submit_businesses, submit_contacts and submit_facts; call complete_task at the end.",
  "Never invent business details. Never contact businesses yourself — create_email_draft only saves a draft that the user approves and sends from WebScout.",
  "If a tool says the user paused or cancelled the work, stop immediately and tell the user.",
].join(" ");

type Ctx = { conn: ClaudeConnection };
type ToolDef = { name: string; title: string; description: string; schema: z.ZodType; readOnly?: boolean; run: (args: never, ctx: Ctx) => Promise<unknown> };
const tool = <S extends z.ZodType>(t: { name: string; title: string; description: string; schema: S; readOnly?: boolean; run: (args: z.infer<S>, ctx: Ctx) => Promise<unknown> }) => t as unknown as ToolDef;

const taskId = z.string().trim().min(4).max(40).describe("The task_id from get_next_task");
const idemKey = z.string().trim().min(1).max(120).describe("A new unique key for each call (e.g. \"abc123-batch-2\"). Reuse it only to retry the exact same call — a retry never creates duplicates.");

/** A retried call with the same key returns the first response instead of saving twice. */
async function once<T>(conn: ClaudeConnection, key: string, toolName: string, taskRef: string | null, fn: () => Promise<T>): Promise<T | (T & { replayed: true })> {
  const prev = await db.claudeSubmission.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: conn.workspaceId, idempotencyKey: key } } });
  if (prev) {
    if (prev.tool !== toolName) throw new AppError("VALIDATION", `idempotency_key “${key}” was already used for ${prev.tool}. Use a new key for each call.`);
    return { ...(prev.response as object), replayed: true } as T & { replayed: true };
  }
  const res = await fn();
  try {
    await db.claudeSubmission.create({ data: { workspaceId: conn.workspaceId, taskId: taskRef, idempotencyKey: key, tool: toolName, response: JSON.parse(JSON.stringify(res ?? {})) } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return res;
}

export const TOOLS: ToolDef[] = [
  tool({
    name: "get_status",
    title: "WebScout status",
    description: "Check the connection to the user's WebScout workspace: workspace name, queued and running tasks, leads left this month, and whether the user has paused automation.",
    schema: z.object({}),
    readOnly: true,
    run: async (_a, { conn }) => {
      const ws = await db.workspace.findUniqueOrThrow({ where: { id: conn.workspaceId }, select: { name: true } });
      const [queued, running, paused, allowance, pausedAll] = await Promise.all([
        db.claudeTask.findMany({ where: { workspaceId: conn.workspaceId, status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true, title: true }, take: 10 }),
        db.claudeTask.findMany({ where: { workspaceId: conn.workspaceId, status: "RUNNING" }, select: { id: true, title: true, progress: true }, take: 10 }),
        db.claudeTask.count({ where: { workspaceId: conn.workspaceId, status: "PAUSED" } }),
        leadAllowance(conn.workspaceId),
        isGloballyPaused(conn.workspaceId),
      ]);
      return {
        connected: true, workspace: ws.name, connection: conn.name, automation_paused: pausedAll,
        queued_tasks: queued.map((t) => ({ task_id: t.id, short_id: shortId(t.id), title: t.title })),
        running_tasks: running.map((t) => ({ task_id: t.id, short_id: shortId(t.id), title: t.title, progress: t.progress })),
        paused_tasks: paused,
        leads_left_this_month: allowance.limit == null ? "unlimited" : allowance.remaining,
        plan: allowance.planName,
        permissions: PERMISSIONS,
        webscout_link: `${appUrl()}/claude`,
      };
    },
  }),
  tool({
    name: "get_next_task",
    title: "Get my next WebScout task",
    description: "Get the next task the user queued in WebScout (or a specific one if they named it) with a full brief: what to research, the rules, and how to report back. Call this when the user asks you to run, start or continue their WebScout task.",
    schema: z.object({ task_id: z.string().trim().max(40).optional().describe("A task id or its last 6 characters, only if the user named a specific task") }),
    run: async (a, { conn }) => {
      const r = await claimTask(conn, a.task_id);
      if (r.state === "ALL_PAUSED") return { status: "paused", message: "The user has paused all automation in WebScout. Don't start any work — tell the user." };
      if (r.state === "NONE") return { status: "no_tasks", message: "No tasks are waiting. The user can create one in WebScout → Claude → “Find leads with Claude”. You can also ask what they'd like you to do and use search_leads / get_lead / submit_businesses directly." };
      if (r.state === "TASK_PAUSED") return { status: "paused", task_id: r.task.id, message: "That task is paused in WebScout. Ask the user to resume it first." };
      if (r.state === "TASK_FINISHED") return { status: r.task.status.toLowerCase(), task_id: r.task.id, message: `That task is already ${r.task.status.toLowerCase()}.` };
      return {
        status: "assigned", task_id: r.task.id, short_id: shortId(r.task.id), type: r.task.type, title: r.task.title,
        brief: await taskBrief(r.task), permissions: PERMISSIONS, watch_live: `${appUrl()}/claude/tasks/${r.task.id}`,
      };
    },
  }),
  tool({
    name: "report_progress",
    title: "Report progress",
    description: "Post a short status line to the task's live activity feed in WebScout (e.g. \"Searching Mississauga dentists — 6 found so far\").",
    schema: z.object({ task_id: taskId, message: z.string().trim().min(2).max(300), percent: z.number().min(0).max(100).optional() }),
    run: async (a, { conn }) => reportProgress((await taskForWrite(conn, a.task_id))!, a.message, a.percent),
  }),
  tool({
    name: "submit_businesses",
    title: "Add businesses to WebScout",
    description: "Add up to 10 businesses you found to the user's CRM. Each needs a name, a city or street address and at least one source URL where you saw it; include phone, website, category, description, services, Google Maps URL and coordinates when you saw them. Include a published business email with email + email_source_url (the exact page where it appears; WebScout opens it to confirm). Tasks can require a phone and/or email — businesses missing them are rejected. Never guess. Duplicates are detected automatically; the reply lists added, duplicate and rejected businesses (with reasons).",
    schema: z.object({ task_id: taskId.optional(), idempotency_key: idemKey, businesses: z.array(BusinessItem).min(1).max(10) }),
    run: async (a, { conn }) => {
      const task = await taskForWrite(conn, a.task_id);
      return once(conn, a.idempotency_key, "submit_businesses", task?.id ?? null, () => submitBusinesses({ conn, task }, a.businesses));
    },
  }),
  tool({
    name: "submit_contacts",
    title: "Add verified business emails",
    description: "Add public business email addresses with the exact page URL where each is published. WebScout opens that page and only saves the address if it appears there, then runs the Canadian anti-spam (CASL) eligibility checks. Only business addresses published by the business — never guessed or personal ones.",
    schema: z.object({ task_id: taskId.optional(), idempotency_key: idemKey, contacts: z.array(ContactItem).min(1).max(25) }),
    run: async (a, { conn }) => {
      const task = await taskForWrite(conn, a.task_id);
      return once(conn, a.idempotency_key, "submit_contacts", task?.id ?? null, () => submitContacts({ conn, task }, a.contacts));
    },
  }),
  tool({
    name: "submit_facts",
    title: "Add research facts",
    description: "Record research about one business: kind \"fact\" (needs source_url — e.g. online_booking: \"No online booking\", services, years_in_business, locations, employees, photo, competitor) or kind \"estimate\" for your own judgement (size, opportunity, recommended_next_action). Revenue only when a public source states it. Short facts are checked against the source page.",
    schema: z.object({ task_id: taskId.optional(), idempotency_key: idemKey, business_id: z.string().min(5).max(40), facts: z.array(FactItem).min(1).max(30) }),
    run: async (a, { conn }) => {
      const task = await taskForWrite(conn, a.task_id);
      return once(conn, a.idempotency_key, "submit_facts", task?.id ?? null, () => submitFacts({ conn, task }, a.business_id, a.facts));
    },
  }),
  tool({
    name: "search_leads",
    title: "Search the CRM",
    description: "Search the user's leads by name, category, city or website; filter by status or by whether an email is on file. Returns business_ids for get_lead, submit_facts, submit_contacts and create_email_draft.",
    schema: z.object({
      query: z.string().trim().max(120).optional(),
      status: z.enum(LEAD_STATUSES).optional(),
      city: z.string().trim().max(120).optional(),
      has_email: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    readOnly: true,
    run: async (a, { conn }) => searchLeads(conn.workspaceId, a),
  }),
  tool({
    name: "get_lead",
    title: "Get a lead's full profile",
    description: "Everything WebScout knows about one business: details, website audit, opportunity score, verified contacts with CASL eligibility, research facts and any pending email draft.",
    schema: z.object({ business_id: z.string().min(5).max(40) }),
    readOnly: true,
    run: async (a, { conn }) => leadProfile(conn.workspaceId, a.business_id),
  }),
  tool({
    name: "create_email_draft",
    title: "Draft an email for approval",
    description: "Save an email to one business as a DRAFT in WebScout (purpose \"outreach\" or \"quote\"). It is never sent by this tool: the user reviews, edits and sends it from their Gmail in WebScout. For quotes, use only prices from the agency's price list (from the task brief) — never invent prices. Reply includes whether sending checks pass.",
    schema: z.object({
      task_id: taskId.optional(),
      idempotency_key: idemKey,
      business_id: z.string().min(5).max(40),
      purpose: z.enum(["outreach", "quote"]).default("outreach"),
      subject: z.string().trim().min(3).max(200),
      body: z.string().trim().min(20).max(10000).describe("Plain text. WebScout adds the sender identity, mailing address and unsubscribe link automatically."),
    }),
    run: async (a, { conn }) => {
      const task = await taskForWrite(conn, a.task_id);
      return once(conn, a.idempotency_key, "create_email_draft", task?.id ?? null, () => createEmailDraft({ conn, task }, a));
    },
  }),
  tool({
    name: "report_error",
    title: "Report a problem",
    description: "Tell WebScout something went wrong. fatal=true marks the task failed (you can't continue); otherwise it's logged and the task keeps running.",
    schema: z.object({ task_id: taskId, message: z.string().trim().min(2).max(1000), fatal: z.boolean().default(false) }),
    run: async (a, { conn }) => reportError((await taskForWrite(conn, a.task_id))!, a.message, a.fatal),
  }),
  tool({
    name: "complete_task",
    title: "Complete the task",
    description: "Mark the task finished with a short summary of what you found. The user is notified.",
    schema: z.object({ task_id: taskId, summary: z.string().trim().min(5).max(4000) }),
    run: async (a, { conn }) => {
      const t = await completeTask((await taskForWrite(conn, a.task_id))!, a.summary);
      return { status: "completed", task_id: t.id, stats: t.stats, results: `${appUrl()}/claude/tasks/${t.id}` };
    },
  }),
];

function inputSchema(s: z.ZodType) {
  const j = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete j.$schema;
  return j;
}

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: inputSchema(t.schema),
    annotations: { title: t.title, readOnlyHint: Boolean(t.readOnly), destructiveHint: false, idempotentHint: Boolean(t.readOnly), openWorldHint: false },
  }));
}

const zodMessage = (e: z.ZodError) => e.issues.slice(0, 8).map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");

export async function callTool(conn: ClaudeConnection, name: unknown, args: unknown) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: [{ type: "text", text: `Unknown tool “${String(name)}”.` }], isError: true };
  const parsed = t.schema.safeParse(args ?? {});
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid arguments — ${zodMessage(parsed.error)}` }], isError: true };
  try {
    const result = (await t.run(parsed.data as never, { conn })) as Record<string, unknown>;
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (e) {
    return { content: [{ type: "text", text: describeError(e) }], isError: true };
  }
}

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcMessage["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function dispatch(conn: ClaudeConnection, m: RpcMessage) {
  const p = m.params ?? {};
  switch (m.method) {
    case "initialize": {
      const requested = String(p.protocolVersion ?? "");
      const ci = (p.clientInfo ?? {}) as { name?: string; version?: string };
      const client = ci.name ? `${ci.name}${ci.version ? ` ${ci.version}` : ""}` : null;
      const idle = !conn.lastSeenAt || Date.now() - conn.lastSeenAt.getTime() > 10 * 60_000;
      await touchConnection(conn, client);
      if (idle) await db.claudeTaskEvent.create({ data: { workspaceId: conn.workspaceId, type: "CLAUDE_CONNECTED", message: `Claude connected${client ? ` (${client})` : ""} via “${conn.name}”` } });
      return rpcResult(m.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : FALLBACK_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(m.id, {});
    case "tools/list":
      await touchConnection(conn);
      return rpcResult(m.id, { tools: toolList() });
    case "tools/call":
      await touchConnection(conn);
      return rpcResult(m.id, await callTool(conn, p.name, p.arguments));
    case "resources/list":
      return rpcResult(m.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(m.id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(m.id, { prompts: [] });
    default:
      return rpcError(m.id, -32601, `Method not found: ${m.method}`);
  }
}

/** POST handler body: authenticates the token, then answers one JSON-RPC message or a batch. */
export async function handleMcpRequest(req: Request, token: string | null) {
  const conn = await authenticateToken(token);
  if (!conn) return json(rpcError(null, -32001, "This WebScout connection link is invalid or was removed. Create a new one in WebScout → Claude."), 401);
  try {
    await rateLimit(`mcp:${conn.id}`, 1500, 3600, "Too many requests from Claude this hour — try again shortly.");
  } catch (e) {
    return json(rpcError(null, -32029, describeError(e)), 429);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error: send JSON-RPC 2.0 as JSON."), 400);
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcMessage[];
  const out: unknown[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") {
      out.push(rpcError(null, -32600, "Invalid request"));
      continue;
    }
    if (typeof m.method !== "string") continue; // a response to a server request — we never send any
    if (!("id" in m)) continue; // notification (e.g. notifications/initialized)
    try {
      out.push(await dispatch(conn, m));
    } catch (e) {
      out.push(rpcError(m.id, -32603, describeError(e)));
    }
  }
  if (!out.length) return new Response(null, { status: 202 });
  return json(batch ? out : out[0]);
}

export const methodNotAllowed = () => new Response(JSON.stringify(rpcError(null, -32000, "Method not allowed — this server answers POST requests only.")), { status: 405, headers: { Allow: "POST", "Content-Type": "application/json" } });
