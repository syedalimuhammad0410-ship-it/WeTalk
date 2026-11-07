import { NextResponse, type NextRequest } from "next/server";
import { describeError } from "@/lib/server/errors";
import { handlePayPalEvent } from "@/lib/server/billing";
import { paypalConfig, verifyPayPalWebhook } from "@/lib/server/paypal";

/** PayPal → WebScout notifications (renewals, failed payments, cancellations). Signature-verified with PayPal. */
export async function POST(req: NextRequest) {
  const event = await req.json().catch(() => null);
  if (!event) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (!paypalConfig().webhookId) return NextResponse.json({ error: "PAYPAL_WEBHOOK_ID is not configured" }, { status: 503 });
  try {
    if (!(await verifyPayPalWebhook(req.headers, event))) return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
    return NextResponse.json(await handlePayPalEvent(event));
  } catch (e) {
    // A 5xx makes PayPal retry later.
    return NextResponse.json({ error: describeError(e) }, { status: 500 });
  }
}
