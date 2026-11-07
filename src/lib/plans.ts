/** Subscription plans (client-safe: used by the homepage, pricing, checkout and the server). */
export const PLAN_IDS = ["FREE", "STARTER", "GROWTH", "UNLIMITED"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Cycle = "MONTHLY" | "YEARLY";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  monthlyCents: number;
  /** Billed once a year — about two months free compared with paying monthly. */
  yearlyCents: number;
  /** New leads per month; null = unlimited. */
  leadsPerMonth: number | null;
  highlight?: boolean;
  bestFor: string;
};

export const PLANS: Plan[] = [
  { id: "FREE", name: "Free", tagline: "Try the whole platform", monthlyCents: 0, yearlyCents: 0, leadsPerMonth: 5, bestFor: "Testing WebScout on a few real businesses" },
  { id: "STARTER", name: "Starter", tagline: "For freelancers getting started", monthlyCents: 999, yearlyCents: 9900, leadsPerMonth: 100, bestFor: "Freelancers who want a steady stream of prospects" },
  { id: "GROWTH", name: "Growth", tagline: "For agencies scaling outreach", monthlyCents: 2099, yearlyCents: 20900, leadsPerMonth: 5000, highlight: true, bestFor: "Agencies prospecting several cities every month" },
  { id: "UNLIMITED", name: "Unlimited", tagline: "No limits, every city", monthlyCents: 5000, yearlyCents: 49900, leadsPerMonth: null, bestFor: "Teams prospecting whole provinces and countries" },
];

/** Everything every plan includes — plans differ only in how many new leads you can find each month. */
export const PLAN_FEATURES = [
  "Business Finder — radius up to 500 km or whole cities, provinces and countries",
  "Website audits with explainable scores",
  "Opportunity scoring & small-business filter",
  "Public business email finder with consent checks",
  "AI website prompts, call scripts and quotes",
  "Personalised outreach emails & follow-ups",
  "Inbox with AI reply drafts",
  "AutoProspect one-click prospecting",
  "CRM pipeline, campaigns, PDF/Excel exports",
];

export const YEARLY_BENEFITS = [
  "About 2 months free compared with paying monthly",
  "Your price is locked for 12 months",
  "One simple payment a year",
];

export const getPlan = (id: string | null | undefined): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0]!;
export const priceCents = (p: Plan, cycle: Cycle) => (cycle === "YEARLY" ? p.yearlyCents : p.monthlyCents);
export const money = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
/** Yearly price per month and the saving versus monthly billing. */
export function yearlyDeal(p: Plan) {
  const perMonth = p.yearlyCents / 12;
  const saving = p.monthlyCents * 12 - p.yearlyCents;
  return { perMonth, saving, percent: p.monthlyCents ? Math.round((saving / (p.monthlyCents * 12)) * 100) : 0 };
}
export const leadsLabel = (p: Plan) => (p.leadsPerMonth == null ? "Unlimited leads" : `${p.leadsPerMonth.toLocaleString("en-US")} leads / month`);
