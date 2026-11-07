import "./guard";
import { randomUUID } from "node:crypto";
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

/** This month's lead allowance: limit (null = unlimited), used and remaining. */
export async function leadAllowance(workspaceId: string) {
  const sub = await getSubscription(workspaceId);
  const plan = getPlan(sub.plan);
  const used = await db.business.count({ where: { workspaceId, isDemo: false, source: { in: [...COUNTED_SOURCES] }, discoveredAt: { gte: monthStart() } } });
  const limit = plan.leadsPerMonth;
  return { plan: plan.id, planName: plan.name, limit, used, remaining: limit == null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used), resetsAt: nextMonthStart() };
}

export function limitReachedMessage(a: { planName: string; limit: number | null; resetsAt: Date }) {
  return `Paused: you've used all ${a.limit} leads in your ${a.planName} plan this month. Upgrade in Settings → Plan & billing to keep finding businesses (your allowance resets ${a.resetsAt.toISOString().slice(0, 10)}).`;
}

/**
 * Activates a plan. Paid plans record a payment — in demo mode nothing is charged
 * (method DEMO_CARD / DEMO_PAYPAL); a real payment provider plugs in here later.
 */
export async function activatePlan(workspaceId: string, userId: string, planId: PlanId, cycle: Cycle, method: "DEMO_CARD" | "DEMO_PAYPAL" | null) {
  const plan = getPlan(planId);
  const amount = priceCents(plan, cycle);
  if (amount > 0 && !method) throw new AppError("VALIDATION", "Choose a payment method.");
  const now = new Date();
  const end = new Date(now);
  if (cycle === "YEARLY") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const sub = await db.subscription.upsert({
    where: { workspaceId },
    create: { workspaceId, plan: plan.id, cycle, status: "ACTIVE", priceCents: amount, currentPeriodStart: now, currentPeriodEnd: plan.id === "FREE" ? nextMonthStart() : end },
    update: { plan: plan.id, cycle, status: "ACTIVE", priceCents: amount, currentPeriodStart: now, currentPeriodEnd: plan.id === "FREE" ? nextMonthStart() : end, note: null },
  });
  let payment = null;
  if (amount > 0) {
    payment = await db.billingPayment.create({ data: { workspaceId, plan: plan.id, cycle, amountCents: amount, method: method!, status: "SUCCEEDED", reference: `demo_${randomUUID().slice(0, 12)}`, createdById: userId } });
  }
  await logActivity({ workspaceId, userId, action: "billing.plan_changed", summary: `Plan set to ${plan.name} (${cycle.toLowerCase()})${amount ? ` — ${method === "DEMO_PAYPAL" ? "PayPal" : "card"} payment (demo, not charged)` : ""}` });
  return { subscription: sub, payment };
}

export async function billingOverview(workspaceId: string) {
  const [sub, allowance, payments] = await Promise.all([
    getSubscription(workspaceId),
    leadAllowance(workspaceId),
    db.billingPayment.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { subscription: sub, allowance: { ...allowance, remaining: Number.isFinite(allowance.remaining) ? allowance.remaining : null }, payments };
}
