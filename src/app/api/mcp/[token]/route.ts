import type { NextRequest } from "next/server";
import { handleMcpRequest, methodNotAllowed } from "@/lib/server/claude/mcp";

/** Claude custom connector URL: https://<app>/api/mcp/<secret token>. */
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return handleMcpRequest(req, (await params).token);
}
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
