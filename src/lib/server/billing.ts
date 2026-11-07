import "./guard";
import { randomUUID } from "node:crypto";
import type { Subscription } from "@prisma/client";
import { db } from "../db";
import { AppError } from "./errors";
import { logActivity } from "./activity";
import { getPlan, priceCents, type Cycle, type PlanId } from "../plans";

/** Leads that count towards the monthly allowance: businesses the platform discovered (not manual adds or imports). */
const COUNTED_SOURCES = ["GOOGLE_PLACES", "OPENSTREETMAP"] as const;

export const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
export const nextMonthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

/** Every workspace has a subscription; one is created on the Free plan if missing. */
export async function getSubscription(workspaceId: string) {
  const existing = await db.subscription.findUnique({ where: { workspaceId } });
  if (existing) return existing;
  return db.subscription.upsert({ where: { workspaceId }, create: { workspaceId, plan: "FREE", currentPeriodEnd: nextMonthStart() }, update: {} });
}

/** The plan in force: a cancelled or unpaid plan stays usable until its paid period ends, then it's Free. */
export function effectivePlan(sub: Pick<Subscription, "plan" | "status" | "currentPeriodEnd">) {
  if (sub.status !== "ACTIVE" && sub.currentPeriodEnd.getTime() < Date.now()) return getPlan("FREE");
  return getPlan(sub.plan);
}

/** This month's lead allowance: limit (null = unlimited), used and remaining. */
export async function leadAllowance(workspaceId: string) {
  const sub = await getSubscription(workspaceId);
  const plan = effectivePlan(sub);
  const used = await db.business.count({ where: { workspaceId, isDemo: false, source: { in: [...COUNTED_SOURCES] }, discoveredAt: { gte: monthStart() } } });
  const limit = plan.leadsPerMonth;
  return { plan: plan.id, planName: plan.name, limit, used, remaining: limit == null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used), resetsAt: nextMonthStart() };
}

export function limitReachedMessage(a: { planName: string; limit: number | null; resetsAt: Date }) {
  return `Paused: you've used all ${a.limit} leads in your ${a.planName} plan this month. Upgrade in Settings → Plan & billing to keep finding businesses (your allowance resets ${a.resetsAt.toISOString().slice(0, 10)}).`;
}

type Method = "DEMO_CARD" | "DEMO_PAYPAL" | "PAYPAL" | null;

/**
 * Activates a plan. Real payments come through PayPal (method PAYPAL, with its subscription id);
 * DEMO_* methods record a simulated payment and charge nothing.
 */
export async function activatePlan(workspaceId: string, userId: string | null, planId: PlanId, cycle: Cycle, method: Method, opts: { providerSubscriptionId?: string; periodEnd?: Date | null; recordPayment?: boolean; currency?: string } = {}) {
  const plan = getPlan(planId);
  const amount = priceCents(plan, cycle);
  if (amount > 0 && !method) throw new AppError("VALIDATION", "Choose a payment method.");
  const now = new Date();
  let end = opts.periodEnd ?? null;
  if (!end) {
    end = new Date(now);
    if (cycle === "YEARLY") end.setUTCFullYear(end.getUTCFullYear() + 1);
    else end.setUTCMonth(end.getUTCMonth() + 1);
  }
  const provider = method === "PAYPAL" ? { provider: "PAYPAL", providerSubscriptionId: opts.providerSubscriptionId ?? null, providerStatus: "ACTIVE" } : { provider: null, providerSubscriptionId: null, providerStatus: null };
  const data = { plan: plan.id, cycle, status: "ACTIVE", priceCents: amount, currentPeriodStart: now, currentPeriodEnd: plan.id === "FREE" ? nextMonthStart() : end, note: null, ...provider };
  const sub = await db.subscription.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
  let payment = null;
  const demo = method === "DEMO_CARD" || method === "DEMO_PAYPAL";
  if (amount > 0 && (demo || opts.recordPayment)) {
    payment = await db.billingPayment.create({ data: { workspaceId, plan: plan.id, cycle, amountCents: amount, currency: opts.currency ?? "USD", method: method!, status: "SUCCEEDED", reference: demo ? `demo_${randomUUID().slice(0, 12)}` : `${opts.providerSubscriptionId}:first`, createdById: userId } });
  }
  const how = method === "PAYPAL" ? " — paid with PayPal" : demo ? ` — ${method === "DEMO_PAYPAL" ? "PayPal" : "card"} payment (demo, not charged)` : "";
  await logActivity({ workspaceId, userId, action: "billing.plan_changed", summary: `Plan set to ${plan.name} (${cycle.toLowerCase()})${amount ? how : ""}` });
  return { subscription: sub, payment };
}

/** Switch to Free; a PayPal subscription is cancelled at PayPal so no further payments are taken. */
export async function downgradeToFree(workspaceId: string, userId: string) {
  const sub = await getSubscription(workspaceId);
  if (sub.provider === "PAYPAL" && sub.providerSubscriptionId && sub.providerStatus !== "CANCELLED") {
    const { cancelPayPalSubscription } = await import("./paypal");
    await cancelPayPalSubscription(sub.providerSubscriptionId, "Customer switched to the Free plan");
  }
  return activatePlan(workspaceId, userId, "FREE", "MONTHLY", null);
}

type PayPalEvent = { id?: string; event_type?: string; resource?: { id?: string; billing_agreement_id?: string; status?: string; amount?: { total?: string; currency?: string }; billing_info?: { next_billing_time?: string } } };

/** Keeps plans in step with PayPal: renewals, failed payments and cancellations. Idempotent. */
export async function handlePayPalEvent(event: PayPalEvent) {
  const r = event.resource ?? {};
  const subId = event.event_type === "PAYMENT.SALE.COMPLETED" ? r.billing_agreement_id : r.id;
  if (!subId) return { handled: false, reason: "no subscription id" };
  const sub = await db.subscription.findUnique({ where: { providerSubscriptionId: subId } });
  if (!sub) return { handled: false, reason: "unknown subscription" };
  switch (event.event_type) {
    case "PAYMENT.SALE.COMPLETED": {
      const reference = r.id ?? event.id ?? randomUUID();
      if (!(await db.billingPayment.findFirst({ where: { workspaceId: sub.workspaceId, reference } }))) {
        await db.billingPayment.create({ data: { workspaceId: sub.workspaceId, plan: sub.plan, cycle: sub.cycle, amountCents: Math.round(Number(r.amount?.total ?? 0) * 100), currency: r.amount?.currency ?? "USD", method: "PAYPAL", status: "SUCCEEDED", reference } });
      }
      let periodEnd: Date | null = null;
      try {
        const { getPayPalSubscription } = await import("./paypal");
        const next = (await getPayPalSubscription(subId)).billing_info?.next_billing_time;
        periodEnd = next ? new Date(next) : null;
      } catch {
        /* fall back to one cycle from now */
      }
      if (!periodEnd) {
        periodEnd = new Date();
        if (sub.cycle === "YEARLY") periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
        else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      }
      await db.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", providerStatus: "ACTIVE", currentPeriodEnd: periodEnd } });
      await logActivity({ workspaceId: sub.workspaceId, action: "billing.payment_received", summary: `PayPal payment received: ${r.amount?.total ?? "?"} ${r.amount?.currency ?? ""}`.trim() });
      return { handled: true };
    }
    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.RE-ACTIVATED":
      await db.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", providerStatus: "ACTIVE" } });
      return { handled: true };
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
      // Paid time is honoured: the plan stays until the end of the period, then becomes Free.
      await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", providerStatus: event.event_type.endsWith("EXPIRED") ? "EXPIRED" : "CANCELLED" } });
      await logActivity({ workspaceId: sub.workspaceId, action: "billing.cancelled", summary: `PayPal subscription ${event.event_type.endsWith("EXPIRED") ? "expired" : "cancelled"}; plan stays until ${sub.currentPeriodEnd.toISOString().slice(0, 10)}` });
      return { handled: true };
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
      await db.subscription.update({ where: { id: sub.id }, data: { status: "PAST_DUE", providerStatus: event.event_type.endsWith("FAILED") ? "PAYMENT_FAILED" : "SUSPENDED" } });
      await logActivity({ workspaceId: sub.workspaceId, action: "billing.payment_failed", summary: "PayPal couldn't take a subscription payment — the plan ends with the current period unless it's paid." });
      return { handled: true };
    default:
      return { handled: false, reason: `ignored ${event.event_type}` };
  }
}

/**
 * Safety net for missed or unconfigured webhooks: PayPal plans whose paid period has ended are
 * checked with PayPal (at most hourly each). Renewed → extended; cancelled/expired/suspended → the plan lapses to Free.
 */
export async function syncDuePayPalSubscriptions(limit = 20) {
  const { paypalConfig, getPayPalSubscription } = await import("./paypal");
  const cfg = paypalConfig();
  if (!cfg.enabled) return 0;
  const now = new Date();
  const due = await db.subscription.findMany({
    where: { provider: "PAYPAL", providerSubscriptionId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lt: now }, updatedAt: { lt: new Date(now.getTime() - 3600_000) } },
    take: limit,
  });
  for (const sub of due) {
    try {
      const s = await getPayPalSubscription(sub.providerSubscriptionId!);
      const next = s.billing_info?.next_billing_time ? new Date(s.billing_info.next_billing_time) : null;
      if (s.status === "ACTIVE" && next && next > now) {
        await db.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", providerStatus: "ACTIVE", currentPeriodEnd: next } });
        const lp = s.billing_info?.last_payment;
        if (!cfg.webhookId && lp?.amount && lp.time) {
          const reference = `${s.id}:${lp.time}`;
          if (!(await db.billingPayment.findFirst({ where: { workspaceId: sub.workspaceId, reference } }))) {
            await db.billingPayment.create({ data: { workspaceId: sub.workspaceId, plan: sub.plan, cycle: sub.cycle, amountCents: Math.round(Number(lp.amount.value) * 100), currency: lp.amount.currency_code, method: "PAYPAL", status: "SUCCEEDED", reference } });
          }
        }
      } else if (s.status === "ACTIVE") {
        await db.subscription.update({ where: { id: sub.id }, data: { providerStatus: "ACTIVE" } }); // PayPal is still retrying the payment: grace period
      } else {
        await db.subscription.update({ where: { id: sub.id }, data: { status: s.status === "SUSPENDED" ? "PAST_DUE" : "CANCELLED", providerStatus: s.status } });
      }
    } catch {
      await db.subscription.update({ where: { id: sub.id }, data: { updatedAt: now } }).catch(() => {}); // retry in an hour
    }
  }
  return due.length;
}

export async function billingOverview(workspaceId: string) {
  const { paypalConfig } = await import("./paypal");
  const [sub, allowance, payments] = await Promise.all([
    getSubscription(workspaceId),
    leadAllowance(workspaceId),
    db.billingPayment.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { subscription: sub, allowance: { ...allowance, remaining: Number.isFinite(allowance.remaining) ? allowance.remaining : null }, payments, paypalEnabled: paypalConfig().enabled };
}
