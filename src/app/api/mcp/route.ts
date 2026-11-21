import type { NextRequest } from "next/server";
import { handleMcpRequest, methodNotAllowed } from "@/lib/server/claude/mcp";
import { bearerToken } from "@/lib/server/claude/connections";

/** Same MCP server with the token in an "Authorization: Bearer" header (desktop extension, or a connector set up with a request header). */
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(req: NextRequest) {
  return handleMcpRequest(req, bearerToken(req));
}
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
