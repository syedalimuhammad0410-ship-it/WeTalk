"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, CardHeader } from "../ui/misc";
import { Button, ButtonLink } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { getPlan, leadsLabel, money } from "@/lib/plans";
import { DateTimeText } from "@/components/ui/time";

export function BillingSettings({ d }: { d: any }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const b = d.billing;
  if (!b) return null;
  const sub = b.subscription;
  const plan = getPlan(sub.plan);
  const a = b.allowance;
  const manage = (d.permissions as string[]).includes("users.manage");
  const pct = a.limit ? Math.min(100, Math.round((a.used / a.limit) * 100)) : 0;
  async function downgrade() {
    setBusy(true);
    try {
      await apiFetch("/api/billing", { body: { action: "downgrade" } });
      toast.success("You're now on the Free plan");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      toast.error("Not changed", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Your plan" description={sub.note ?? (sub.plan === "FREE" ? "Free forever — upgrade any time." : `Renews ${sub.cycle === "YEARLY" ? "yearly" : "monthly"}.`)} action={manage && <ButtonLink href={`/checkout?plan=${sub.plan === "UNLIMITED" ? "UNLIMITED" : "GROWTH"}&cycle=${sub.cycle}`}>Change plan</ButtonLink>} />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold">{plan.name}</span>
            <Badge tone={sub.plan === "FREE" ? "zinc" : "green"}>{sub.status.toLowerCase()}</Badge>
            <span className="text-sm text-muted">{sub.priceCents ? `${money(sub.priceCents)} / ${sub.cycle === "YEARLY" ? "year" : "month"}` : "$0"} · {leadsLabel(plan)}</span>
          </div>
          {sub.plan !== "FREE" && !sub.note && <div className="text-sm text-muted">Current period ends <DateTimeText d={sub.currentPeriodEnd} /></div>}
          <div>
            <div className="mb-1 flex justify-between text-sm"><span>Leads this month</span><span className="tabular-nums">{a.used.toLocaleString("en-US")}{a.limit != null ? ` of ${a.limit.toLocaleString("en-US")}` : " (unlimited)"}</span></div>
            {a.limit != null && <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>}
            <div className="mt-1 text-xs text-muted">Counts new businesses WebScout discovers for you. Businesses you add or import yourself are free. Resets <DateTimeText d={a.resetsAt} />.</div>
          </div>
          {manage && sub.plan !== "FREE" && <Button variant="ghost" onClick={() => setConfirm(true)}>Switch to the Free plan</Button>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Payments" description={b.paypalEnabled ? "Paid securely through PayPal — receipts are emailed by PayPal. Switching to Free cancels the PayPal subscription so you aren't billed again." : "Payments are in demo mode while billing is being set up — nothing has been charged."} />
        {sub.provider === "PAYPAL" && sub.providerSubscriptionId && <p className="px-5 pb-1 text-xs text-muted">PayPal subscription {sub.providerSubscriptionId} · {String(sub.providerStatus ?? "").toLowerCase().replace("_", " ")}</p>}
        {b.payments.length === 0 ? <p className="px-5 py-4 text-sm text-muted">No payments yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {b.payments.map((p: any) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-medium">{getPlan(p.plan).name} ({p.cycle.toLowerCase()})</span>
                <span className="tabular-nums">{money(p.amountCents)}{p.currency && p.currency !== "USD" ? ` ${p.currency}` : ""}</span>
                {p.method === "PAYPAL" ? <Badge tone="green">paid</Badge> : <Badge tone="amber">demo — not charged</Badge>}
                <span className="text-xs text-muted">{p.method === "DEMO_CARD" ? "Card" : "PayPal"} · {p.reference}</span>
                <span className="ml-auto text-xs text-faint"><DateTimeText d={p.createdAt} /></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Switch to the Free plan?" confirmLabel="Switch to Free" loading={busy} onConfirm={downgrade} description="You'll be limited to 5 new leads a month. All your leads and data are kept." />
    </div>
  );
}
