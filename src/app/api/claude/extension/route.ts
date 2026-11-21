import { NextResponse } from "next/server";
import { api } from "@/lib/server/api";
import { buildExtension } from "@/lib/server/claude/extension";

/** Download the WebScout extension for Claude Desktop (contains no secrets — the link is entered at install). */
export const GET = api({ permission: "leads.view" }, async () => {
  const buf = await buildExtension();
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="webscout-ai.mcpb"', "Cache-Control": "no-store" } });
});
