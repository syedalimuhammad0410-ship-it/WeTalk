import { NextResponse } from "next/server";
import { kickRunner } from "@/lib/server/jobs/runner";

export const dynamic = "force-dynamic";

/**
 * Public keep-alive endpoint. On hosts that sleep when idle (e.g. Render's free
 * plan), an external scheduler can call this every few minutes; it also wakes
 * the in-process background job runner. Returns no data.
 */
export function GET() {
  kickRunner();
  return NextResponse.json({ ok: true });
}
