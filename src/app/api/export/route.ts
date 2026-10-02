import { z } from "zod";
import { readJson, route } from "@/lib/server/api";
import { getInvestigation } from "@/lib/server/investigations";
import { toCsv, toJson, toMarkdown, toText } from "@/lib/engine/report";

/** Server-side export (JSON, CSV, Markdown, text). PDF and PNG are rendered in the browser. */
export const POST = route(async (req, { user }) => {
  const b = await readJson(req, z.object({ investigationId: z.string().max(64), format: z.enum(["json", "csv", "md", "txt"]) }));
  const inv = await getInvestigation(user.email, b.investigationId);
  const body = b.format === "json" ? toJson(inv) : b.format === "csv" ? toCsv(inv) : b.format === "md" ? toMarkdown(inv) : toText(inv);
  const type = { json: "application/json", csv: "text/csv", md: "text/markdown", txt: "text/plain" }[b.format];
  const name = `${inv.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) || "investigation"}.${b.format}`;
  return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${name}"` } });
}, { limit: 30, name: "export" });
