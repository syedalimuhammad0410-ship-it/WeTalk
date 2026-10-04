import { NextResponse } from "next/server";
import { publicApi } from "@/lib/server/api";
import { destroySession } from "@/lib/server/auth";

export const POST = publicApi(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
