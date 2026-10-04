import * as z from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, jsonError, parseBody } from "@/lib/server/api";
import { getSessionUser } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { acceptInvitation } from "@/lib/server/members";

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const user = await getSessionUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Sign in to accept the invitation.");
    const { token } = await parseBody(req, z.object({ token: z.string().min(10) }));
    await acceptInvitation(token, user.id, user.email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
