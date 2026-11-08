"use client";
import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLANS, PLAN_FEATURES, YEARLY_BENEFITS, leadsLabel, money, priceCents, yearlyDeal, type Cycle } from "@/lib/plans";

/** Public pricing cards with a monthly / yearly switch. */
export function PricingTable({ loggedIn, currency }: { loggedIn: boolean; currency: string }) {
  const [cycle, setCycle] = useState<Cycle>("MONTHLY");
  const per = (unit: string) => `${currency === "USD" ? "" : currency}/${unit}`;
  const href = (plan: string) => {
    const checkout = `/checkout?plan=${plan}&cycle=${cycle}`;
    return loggedIn ? checkout : `/signup?next=${encodeURIComponent(checkout)}`;
  };
  return (
    <div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-border bg-surface p-1 text-sm shadow-sm">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCycle(c)} className={cn("rounded-full px-5 py-2 font-medium transition-colors", cycle === c ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}>
              {c === "MONTHLY" ? "Monthly" : "Yearly · 2 months free"}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted">All prices in {currency === "CAD" ? "Canadian dollars (CAD)" : currency === "USD" ? "US dollars (USD)" : currency}</p>
      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((p) => {
          const price = priceCents(p, cycle);
          const deal = yearlyDeal(p);
          return (
            <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-surface p-6 shadow-sm", p.highlight ? "border-accent ring-2 ring-accent/25" : "border-border")}>
              {p.highlight && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg">Most popular</span>}
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-sm text-muted">{p.tagline}</div>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">{price === 0 ? "$0" : money(price)}</span>
                <span className="text-sm text-muted">{price === 0 ? "forever" : per(cycle === "YEARLY" ? "year" : "month")}</span>
              </div>
              <div className="mt-1 h-5 text-xs text-emerald-600">{cycle === "YEARLY" && p.monthlyCents > 0 ? `≈ ${money(Math.round(deal.perMonth))}/mo — you save ${money(deal.saving)}` : ""}</div>
              <div className="mt-4 rounded-lg bg-subtle px-3 py-2 text-sm font-semibold">{leadsLabel(p)}</div>
              <p className="mt-3 text-sm text-muted">{p.bestFor}</p>
              <Link href={href(p.id)} className={cn("mt-6 inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors", p.highlight ? "bg-accent text-accent-fg hover:opacity-90" : "border border-border hover:bg-subtle")}>
                {p.id === "FREE" ? "Start free" : `Get ${p.name}`}
              </Link>
            </div>
          );
        })}
      </div>
      <div className="mt-10 grid gap-6 rounded-2xl border border-border bg-surface p-6 lg:grid-cols-2">
        <div>
          <div className="font-semibold">Every plan includes every feature</div>
          <ul className="mt-3 grid gap-2 text-sm text-muted">{PLAN_FEATURES.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>)}</ul>
        </div>
        <div>
          <div className="font-semibold">Why go yearly?</div>
          <ul className="mt-3 grid gap-2 text-sm text-muted">{YEARLY_BENEFITS.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>)}</ul>
          <div className="mt-4 overflow-hidden rounded-lg border border-border text-sm">
            <table className="w-full">
              <thead className="bg-subtle text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Plan</th><th className="px-3 py-2 font-medium">Monthly</th><th className="px-3 py-2 font-medium">Yearly</th><th className="px-3 py-2 font-medium">You save</th></tr></thead>
              <tbody className="divide-y divide-border">
                {PLANS.filter((p) => p.monthlyCents > 0).map((p) => <tr key={p.id}><td className="px-3 py-2 font-medium">{p.name}</td><td className="px-3 py-2">{money(p.monthlyCents)}/mo</td><td className="px-3 py-2">{money(p.yearlyCents)}/yr</td><td className="px-3 py-2 text-emerald-600">{money(yearlyDeal(p).saving)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
