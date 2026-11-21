import * as z from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authenticateToken, bearerToken, companionHeartbeat } from "@/lib/server/claude/connections";

/** The desktop extension (local companion) checks in while Claude Desktop is open. */
export async function POST(req: NextRequest) {
  const conn = await authenticateToken(bearerToken(req));
  if (!conn) return NextResponse.json({ error: "Invalid or removed WebScout connection link." }, { status: 401 });
  const b = z.object({ device: z.string().max(80).optional(), platform: z.string().max(40).optional(), version: z.string().max(20).optional() }).safeParse(await req.json().catch(() => ({})));
  await companionHeartbeat(conn, b.success ? b.data : {});
  const queued = await db.claudeTask.count({ where: { workspaceId: conn.workspaceId, status: "QUEUED" } });
  return NextResponse.json({ ok: true, queued });
}
