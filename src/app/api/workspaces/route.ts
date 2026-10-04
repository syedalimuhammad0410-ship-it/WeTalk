import * as z from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, jsonError, parseBody } from "@/lib/server/api";
import { getSessionUser } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { createWorkspace } from "@/lib/server/workspace";

// Creating a workspace only requires a signed-in user (they may not belong to any workspace yet).
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const user = await getSessionUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const body = await parseBody(req, z.object({ name: z.string().trim().min(2, "Workspace name must be at least 2 characters").max(80) }));
    const ws = await createWorkspace(user.id, body.name);
    return NextResponse.json({ id: ws.id, slug: ws.slug });
  } catch (e) {
    return jsonError(e);
  }
}
