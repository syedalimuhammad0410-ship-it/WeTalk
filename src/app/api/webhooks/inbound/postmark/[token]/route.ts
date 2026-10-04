import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/server/crypto";
import { parsePostmarkInbound } from "@/lib/server/email/providers";
import { ingestInbound } from "@/lib/server/email/inbound";
import { rateLimit } from "@/lib/server/ratelimit";

/** Postmark inbound webhook. Authenticated by the secret token in the URL (stored hashed). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    await rateLimit(`inbound:${sha256(token).slice(0, 16)}`, 600, 3600);
  } catch {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  const account = await db.emailAccount.findUnique({ where: { inboundTokenHash: sha256(token) } });
  if (!account || account.provider !== "POSTMARK") return NextResponse.json({ error: "unknown endpoint" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const msg = parsePostmarkInbound(body);
  if (!msg.providerMessageId || !msg.from) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const r = await ingestInbound(account, msg);
  return NextResponse.json({ ok: true, matchedBy: r?.matchedBy ?? "ignored" });
}
