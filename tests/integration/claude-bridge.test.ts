/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { upsertBusiness } from "@/lib/server/leads";
import { setMxResolverForTests } from "@/lib/server/contacts/discover";
import { createConnection, revokeConnection } from "@/lib/server/claude/connections";
import { controlTask, createTask, CreateTaskInput } from "@/lib/server/claude/tasks";
import { commandCentre, resumeEverything, stopEverything } from "@/lib/server/claude/centre";
import { handleMcpRequest } from "@/lib/server/claude/mcp";
import { makeWorkspace } from "../helpers";

let server: http.Server;
let site: string;
beforeAll(async () => {
  setMxResolverForTests(async () => [{ exchange: "mx.example" }]);
  server = http.createServer((req, res) => {
    if (req.url === "/robots.txt") return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/html" }).end(`<html><body><h1>Crumb &amp; Co Bakery</h1><p>Fresh bread daily since 2009.</p><p>Email us: <a href="mailto:hello@crumbbakery.test">hello@crumbbakery.test</a></p><p>Open 7am–6pm</p></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
  site = `http://127.0.0.2:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  setMxResolverForTests(null);
});

/** Talks to the MCP endpoint exactly as Claude does: JSON-RPC over HTTP POST. */
function client(token: string) {
  let id = 0;
  const post = async (body: unknown) => {
    const res = await handleMcpRequest(new Request("http://app.test/api/mcp/x", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }), token);
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  };
  return {
    post,
    rpc: async (method: string, params: Record<string, unknown> = {}) => (await post({ jsonrpc: "2.0", id: ++id, method, params })).body,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const r = await post({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } });
      const result = r.body.result as { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean };
      return { error: result.isError ? result.content[0]!.text : null, data: (result.structuredContent ?? {}) as Record<string, any> };
    },
  };
}

const bakery = (name: string, extra: Record<string, unknown> = {}) => ({ name, category: "Bakery", city: "Toronto", region: "ON", country: "Canada", latitude: 43.65, longitude: -79.38, sources: [{ url: "https://maps.example/bakery", type: "maps" }], ...extra });

describe("Claude bridge (MCP connector)", () => {
  it("runs a find-leads task end to end with verification, idempotency, pause and stop", async () => {
    const { ws, owner } = await makeWorkspace();
    const { token, url, connection } = await createConnection(ws.id, owner.id, "Claude Desktop");
    expect(url).toMatch(/\/api\/mcp\/wsc_/);
    const c = client(token);

    // Handshake and tool discovery, as Claude does it.
    const init = await c.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1.0" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "webscout-ai" }, capabilities: { tools: {} } });
    expect((await c.post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const tools = (await c.rpc("tools/list")).result.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_status", "get_next_task", "submit_businesses", "submit_contacts", "submit_facts", "create_email_draft", "complete_task"]));
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect((await c.call("get_next_task")).data.status).toBe("no_tasks");

    // The user queues a task; Claude picks it up with a full brief.
    const task = await createTask(ws.id, owner.id, CreateTaskInput.parse({ type: "FIND_LEADS", params: { locations: ["Toronto, ON"], businessTypes: ["bakeries"], count: 3 } }));
    const next = (await c.call("get_next_task")).data;
    expect(next).toMatchObject({ status: "assigned", task_id: task.id });
    expect(next.brief).toContain("submit_businesses");
    expect(next.brief).toContain("Never invent");
    expect((await db.claudeTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("RUNNING");

    // Results: new, duplicate, too vague, and a chain.
    await upsertBusiness(ws.id, { name: "Sweet Spot", website: "https://sweetspot.test", city: "Toronto", source: "MANUAL" });
    const batch = {
      task_id: task.id,
      idempotency_key: "t-1",
      businesses: [
        bakery("Crumb & Co Bakery", { website: site, phone: "416-555-0101", description: "Family bakery", services: ["Bread", "Cakes"], photo_urls: ["https://img.example/crumb.jpg"] }),
        bakery("Sweet Spot Bakery", { website: "https://www.sweetspot.test/" }),
        { name: "Mystery Bakery", sources: [{ url: "https://maps.example/x" }] },
        bakery("Tim Hortons", { review_count: 4000 }),
      ],
    };
    const s1 = await c.call("submit_businesses", batch);
    expect(s1.error).toBeNull();
    const r1 = s1.data;
    expect(r1.added.map((a: { name: string }) => a.name)).toEqual(["Crumb & Co Bakery"]);
    expect(r1.duplicates).toHaveLength(1);
    expect(r1.rejected.map((x: { name: string }) => x.name)).toEqual(["Mystery Bakery", "Tim Hortons"]);
    const crumb = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, name: "Crumb & Co Bakery" } });
    expect(crumb).toMatchObject({ source: "CLAUDE_RESEARCH", imageUrl: "https://img.example/crumb.jpg", latitude: 43.65 });
    expect(await db.businessEvidence.count({ where: { businessId: crumb.id } })).toBeGreaterThanOrEqual(4);
    expect(await db.job.count({ where: { workspaceId: ws.id, type: "WEBSITE_AUDIT" } })).toBe(1);

    // A retry with the same key never creates duplicates.
    const r2 = (await c.call("submit_businesses", batch)).data;
    expect(r2.replayed).toBe(true);
    expect(await db.business.count({ where: { workspaceId: ws.id, source: "CLAUDE_RESEARCH" } })).toBe(1);

    // Emails are saved only when they appear on the cited page.
    const contacts = (await c.call("submit_contacts", { task_id: task.id, idempotency_key: "c-1", contacts: [
      { business_id: crumb.id, email: "hello@crumbbakery.test", source_url: `${site}/contact` },
      { business_id: crumb.id, email: "owner@crumbbakery.test", source_url: `${site}/contact` },
    ] })).data;
    expect(contacts.verified.map((v: { email: string }) => v.email)).toEqual(["hello@crumbbakery.test"]);
    expect(contacts.rejected[0].reason).toMatch(/doesn't appear on that page/);
    expect((await db.business.findUniqueOrThrow({ where: { id: crumb.id } })).email).toBe("hello@crumbbakery.test");

    // Facts need sources; judgements are estimates; revenue can't be estimated; short facts are checked on the page.
    const facts = (await c.call("submit_facts", { task_id: task.id, idempotency_key: "f-1", business_id: crumb.id, facts: [
      { field: "Founded", value: "since 2009", source_url: site },
      { field: "online_booking", value: "No online ordering" },
      { field: "size", value: "Small — one location", kind: "estimate" },
      { field: "annual revenue", value: "$400k", kind: "estimate" },
    ] })).data;
    expect(facts).toMatchObject({ saved: 2, verified_on_page: 1 });
    expect(facts.rejected.map((x: { field: string }) => x.field)).toEqual(["online_booking", "annual_revenue"]);

    // Drafts are saved for approval, never sent.
    const draft = (await c.call("create_email_draft", { task_id: task.id, idempotency_key: "d-1", business_id: crumb.id, purpose: "outreach", subject: "Online ordering for Crumb & Co", body: "Hi! I noticed you don't take orders online yet — happy to share ideas." })).data;
    expect(draft.status).toMatch(/NOT been sent/);
    expect(await db.emailMessage.count({ where: { businessId: crumb.id, status: "DRAFT" } })).toBe(1);
    expect(await db.emailMessage.count({ where: { businessId: crumb.id, status: { not: "DRAFT" } } })).toBe(0);

    // Pausing stops Claude at its next call; so does the emergency stop.
    await controlTask(ws.id, owner.id, task.id, "pause");
    expect((await c.call("report_progress", { task_id: task.id, message: "still going" })).error).toMatch(/paused this task/);
    await controlTask(ws.id, owner.id, task.id, "resume");
    await stopEverything(ws.id, owner.id);
    expect((await c.call("get_next_task")).data.status).toBe("paused");
    expect((await c.call("submit_facts", { idempotency_key: "f-2", business_id: crumb.id, facts: [{ field: "note", value: "y", kind: "estimate" }] })).error).toMatch(/paused all automation/);
    await resumeEverything(ws.id, owner.id);
    expect((await db.claudeTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("RUNNING");

    const done = (await c.call("complete_task", { task_id: task.id, summary: "Found one new bakery." })).data;
    expect(done.status).toBe("completed");
    const centre = await commandCentre(ws.id);
    expect(centre.events.map((e) => e.type)).toEqual(expect.arrayContaining(["CLAUDE_CONNECTED", "CLAIMED", "BUSINESS_CREATED", "BUSINESS_DUPLICATE", "BUSINESS_REJECTED", "CONTACT_VERIFIED", "FACTS_ADDED", "DRAFT_CREATED", "PAUSED", "COMPLETED"]));
    expect(centre.connections[0]).toMatchObject({ name: "Claude Desktop", state: "active" });

    // A removed link stops working immediately.
    await revokeConnection(ws.id, owner.id, connection.id);
    expect((await c.post({ jsonrpc: "2.0", id: 99, method: "tools/list" })).status).toBe(401);
  });

  it("keeps workspaces apart and enforces the plan's lead allowance", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    const other = await upsertBusiness(b.ws.id, { name: "Other Co", city: "Ottawa", source: "MANUAL" });
    const { token } = await createConnection(a.ws.id, a.owner.id, "A");
    const c = client(token);
    expect((await c.call("get_lead", { business_id: other.business.id })).error).toMatch(/No business/);

    await db.subscription.update({ where: { workspaceId: a.ws.id }, data: { plan: "FREE" } });
    const many = Array.from({ length: 7 }, (_, i) => bakery(`Corner Bakery ${i}`, { latitude: 43.6 + i * 0.01, sources: [{ url: `https://maps.example/${i}` }] }));
    const r = (await c.call("submit_businesses", { idempotency_key: "free-1", businesses: many })).data;
    expect(r.added).toHaveLength(5);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toMatch(/used all 5 leads/);
  });
});

describe("Claude Desktop extension download", () => {
  it("packs a valid .mcpb with the manifest and the stdio bridge", async () => {
    const { buildExtension } = await import("@/lib/server/claude/extension");
    const buf = await buildExtension();
    expect(buf.subarray(0, 4).toString("hex")).toBe("504b0304"); // zip
    const out = process.env.EXTENSION_OUT;
    if (out) (await import("node:fs")).writeFileSync(out, buf);
    expect(buf.includes(Buffer.from("manifest.json"))).toBe(true);
    expect(buf.includes(Buffer.from("server/index.js"))).toBe(true);
  });
});
