import { NextResponse } from "next/server";
import { EXAMPLES } from "@/lib/examples";

export async function GET() {
  return NextResponse.json({ examples: EXAMPLES });
}
