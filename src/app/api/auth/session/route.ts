import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/api";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user });
}
