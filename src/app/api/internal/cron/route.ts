import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runScheduledTick } from "@/lib/server/jobs/runner";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 24) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Background-job tick for serverless hosts (JOB_RUNNER=cron). Called once a
 * minute by the Cloudflare cron trigger (worker.ts) or any external scheduler,
 * with `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  const result = await runScheduledTick();
  return NextResponse.json({ ok: true, ...result });
}
