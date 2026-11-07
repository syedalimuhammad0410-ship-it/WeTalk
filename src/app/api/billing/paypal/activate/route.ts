import * as z from "zod";
import { db } from "@/lib/db";
import { api, parseBody } from "@/lib/server/api";
import { AppError } from "@/lib/server/errors";
import { activatePlan, getSubscription } from "@/lib/server/billing";
import { cancelPayPalSubscription, getPayPalSubscription, paypalConfig, paypalPlanId } from "@/lib/server/paypal";
import { PLAN_IDS } from "@/lib/plans";

const Body = z.object({ subscriptionId: z.string().trim().min(5).max(64), plan: z.enum(PLAN_IDS), cycle: z.enum(["MONTHLY", "YEARLY"]) });

/** After the customer approves in PayPal: verify the subscription with PayPal itself, then switch the plan on. */
export const POST = api({ permission: "users.manage" }, async (req, ctx) => {
  const b = await parseBody(req, Body);
  const s = await getPayPalSubscription(b.subscriptionId);
  if (!["ACTIVE", "APPROVED"].includes(s.status)) throw new AppError("VALIDATION", `PayPal reports this subscription as ${s.status.toLowerCase()} — it hasn't been paid.`);
  if (s.custom_id !== ctx.workspace.id) throw new AppError("FORBIDDEN", "This PayPal subscription belongs to a different workspace.");
  if (s.plan_id !== (await paypalPlanId(b.plan, b.cycle))) throw new AppError("VALIDATION", "The PayPal subscription doesn't match the plan you chose.");
  const owner = await db.subscription.findUnique({ where: { providerSubscriptionId: s.id } });
  if (owner && owner.workspaceId !== ctx.workspace.id) throw new AppError("CONFLICT", "This PayPal subscription is already in use.");
  const previous = await getSubscription(ctx.workspace.id);
  await activatePlan(ctx.workspace.id, ctx.user.id, b.plan, b.cycle, "PAYPAL", {
    providerSubscriptionId: s.id,
    periodEnd: s.billing_info?.next_billing_time ? new Date(s.billing_info.next_billing_time) : null,
    // Without webhooks there is no other record of the first payment.
    recordPayment: !paypalConfig().webhookId,
    currency: paypalConfig().currency,
  });
  // Changing plan: stop the old PayPal subscription so the customer isn't billed twice.
  if (previous.provider === "PAYPAL" && previous.providerSubscriptionId && previous.providerSubscriptionId !== s.id && previous.providerStatus !== "CANCELLED") {
    await cancelPayPalSubscription(previous.providerSubscriptionId, "Replaced by a new WebScout plan").catch(() => {});
  }
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspace.id }, select: { onboardingCompleted: true } });
  return { ok: true, next: ws.onboardingCompleted ? "/dashboard" : "/onboarding", paymentReference: s.id };
});
