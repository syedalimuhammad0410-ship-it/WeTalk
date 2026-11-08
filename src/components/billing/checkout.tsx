"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, CreditCard, Lock, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/form";
import { Alert } from "../ui/misc";
import { useToast } from "../ui/toast";
import { PayPalButtons, type PayPalHandlers } from "./paypal-buttons";
import { apiFetch } from "@/lib/client";
import { cn } from "@/lib/utils";
import { PLANS, PLAN_FEATURES, YEARLY_BENEFITS, getPlan, leadsLabel, money, priceCents, yearlyDeal, type Cycle, type PlanId } from "@/lib/plans";

type Props = {
  userName: string; hasWorkspace: boolean; workspaceName: string | null; canManage: boolean; currentPlan: string | null; onboardingDone: boolean; initialPlan: PlanId | null; initialCycle: Cycle;
  /** Set when PayPal keys are configured: real payments. Otherwise checkout runs in demo mode. */
  paypal: { clientId: string; currency: string; live: boolean } | null;
  billingCurrency: string;
};

const STEPS = ["Choose a plan", "Payment", "Connect your tools", "Find clients"];

/** Plan selection + payment: real PayPal subscriptions when configured, otherwise a demo (card details stay in the browser). */
export function Checkout({ userName, hasWorkspace, workspaceName, canManage, currentPlan, onboardingDone, initialPlan, initialCycle, paypal, billingCurrency }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [planId, setPlanId] = useState<PlanId>(initialPlan ?? (currentPlan as PlanId) ?? "FREE");
  const [cycle, setCycle] = useState<Cycle>(initialCycle);
  const [name, setName] = useState("");
  const [method, setMethod] = useState<"DEMO_CARD" | "DEMO_PAYPAL">("DEMO_CARD");
  const [card, setCard] = useState({ holder: userName, number: "4242 4242 4242 4242", expiry: "12/30", cvc: "123" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ next: string; reference: string | null; real: boolean } | null>(null);
  const pending = useRef<{ plan: PlanId; cycle: Cycle } | null>(null);
  const plan = getPlan(planId);
  const amount = priceCents(plan, cycle);
  const deal = yearlyDeal(plan);
  const isCurrent = currentPlan === planId;
  const usePayPal = Boolean(paypal) && amount > 0;
  const currency = billingCurrency !== "USD" ? ` ${billingCurrency}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (usePayPal) return; // paid through the PayPal buttons
    if (!hasWorkspace && name.trim().length < 2) return toast.error("Enter your agency or business name");
    setBusy(true);
    try {
      if (amount > 0) await new Promise((r) => setTimeout(r, 1200)); // simulated payment processing
      const r = await apiFetch<{ next: string; paymentReference: string | null }>("/api/billing/checkout", { body: { plan: planId, cycle, method: amount > 0 ? method : null, workspaceName: hasWorkspace ? undefined : name.trim() } });
      setDone({ next: r.next, reference: r.paymentReference, real: false });
      router.refresh();
    } catch (err) {
      toast.error("Could not complete", (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const paypalHandlers: PayPalHandlers = {
    onClick: () => {
      if (!hasWorkspace && name.trim().length < 2) {
        toast.error("Enter your agency or business name first");
        return false;
      }
      return true;
    },
    createSubscription: async () => {
      const r = await apiFetch<{ paypalPlanId: string; customId: string }>("/api/billing/paypal/start", { body: { plan: planId, cycle, workspaceName: hasWorkspace ? undefined : name.trim() } });
      pending.current = { plan: planId, cycle };
      return { plan_id: r.paypalPlanId, custom_id: r.customId };
    },
    onApprove: async (subscriptionId) => {
      const p = pending.current ?? { plan: planId, cycle };
      setBusy(true);
      try {
        const r = await apiFetch<{ next: string; paymentReference: string }>("/api/billing/paypal/activate", { body: { subscriptionId, plan: p.plan, cycle: p.cycle } });
        setPlanId(p.plan);
        setCycle(p.cycle);
        setDone({ next: r.next, reference: r.paymentReference, real: true });
        router.refresh();
      } catch (err) {
        toast.error("PayPal approved the payment, but your plan didn't switch on", `${(err as Error).message} Refresh this page and try again — your PayPal subscription is ${subscriptionId}.`);
      } finally {
        setBusy(false);
      }
    },
    onCancel: () => toast.info("Payment cancelled — you weren't charged."),
    onError: (message) => toast.error("Payment not completed", message),
  };

  if (done) {
    return (
      <Shell step={2}>
        <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-4 text-2xl font-semibold">{amount > 0 ? "Payment successful" : "You're on the Free plan"}</h1>
          <p className="mt-2 text-sm text-muted">{plan.name} · {leadsLabel(plan)}{amount > 0 ? ` · ${money(amount)}${currency} ${cycle === "YEARLY" ? "per year" : "per month"}` : ""}</p>
          {done.reference && (done.real
            ? <p className="mt-1 text-xs text-faint">Paid with PayPal · subscription {done.reference}. PayPal emails you a receipt; cancel any time in Settings → Plan &amp; billing.</p>
            : <p className="mt-1 text-xs text-faint">Demo payment reference {done.reference} — nothing was charged.</p>)}
          <p className="mt-5 text-sm">{done.next === "/onboarding" ? "Next, connect your tools: your free Gemini AI key, Gmail for sending emails, and (optionally) Google Places for the most complete business search." : "Your new plan is active."}</p>
          <Button className="mt-6 h-11 w-full text-base" onClick={() => router.push(done.next)}>{done.next === "/onboarding" ? "Connect my tools →" : "Back to WebScout →"}</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell step={amount > 0 ? 1 : 0}>
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{hasWorkspace ? "Change your plan" : `Welcome, ${userName.split(" ")[0]} — choose your plan`}</h1>
          <p className="mt-2 text-muted">Every plan includes every feature. Plans differ only in how many new leads you can find each month.{currency && ` Prices in${currency}.`}</p>
          <div className="mt-5 inline-flex rounded-full border border-border bg-surface p-1 text-sm">
            {(["MONTHLY", "YEARLY"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCycle(c)} className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", cycle === c ? "bg-accent text-accent-fg" : "text-muted hover:text-fg")}>
                {c === "MONTHLY" ? "Monthly" : "Yearly — 2 months free"}
              </button>
            ))}
          </div>
        </div>
        {!canManage && <Alert tone="warning" className="mt-6" title="Only the workspace owner or an admin can change the plan." />}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => {
            const price = priceCents(p, cycle);
            const selected = p.id === planId;
            return (
              <button key={p.id} type="button" onClick={() => setPlanId(p.id)} className={cn("relative rounded-2xl border bg-surface p-5 text-left transition-all", selected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/50")}>
                {p.highlight && <span className="absolute -top-2.5 right-4 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-fg">Most popular</span>}
                {currentPlan === p.id && <span className="absolute -top-2.5 left-4 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">Current plan</span>}
                <div className="flex items-center justify-between"><span className="font-semibold">{p.name}</span>{selected && <CheckCircle2 className="h-5 w-5 text-accent" />}</div>
                <div className="mt-3 flex items-baseline gap-1"><span className="text-3xl font-bold">{price === 0 ? "$0" : money(price)}</span><span className="text-sm text-muted">{price === 0 ? "forever" : `${currency.trim()}/${cycle === "YEARLY" ? "year" : "month"}`}</span></div>
                {cycle === "YEARLY" && p.monthlyCents > 0 && <div className="mt-1 text-xs text-emerald-600">≈ {money(Math.round(yearlyDeal(p).perMonth))}/month · save {money(yearlyDeal(p).saving)}</div>}
                <div className="mt-3 text-sm font-medium">{leadsLabel(p)}</div>
                <div className="mt-1 text-xs text-muted">{p.bestFor}</div>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            {!hasWorkspace && (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <Field label="Your agency or business name" htmlFor="co-name" required hint="This becomes your workspace — you can change it later."><Input id="co-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Naqvi Helpers" /></Field>
              </div>
            )}
            {usePayPal ? (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="mb-2 flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 text-muted" /> Secure payment with PayPal</div>
                <p className="text-sm text-muted">Pay with your PayPal account or a debit/credit card using the buttons in the order summary. Card details go straight to PayPal — WebScout never sees them.</p>
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{money(amount)}{currency} today, then every {cycle === "YEARLY" ? "year" : "month"} until you cancel</li>
                  <li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />Cancel any time in Settings → Plan &amp; billing (or in your PayPal account)</li>
                </ul>
                {!paypal!.live && <Alert tone="warning" className="mt-4" title="PayPal test mode (sandbox)">Log in with a PayPal sandbox buyer account. No real money moves until PAYPAL_MODE is set to live.</Alert>}
              </div>
            ) : amount > 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="mb-3 flex items-center gap-2 font-semibold"><Lock className="h-4 w-4 text-muted" /> Payment</div>
                <Alert tone="warning" title="Demo mode — no real payment is taken">Payments are simulated while billing is being set up. Don&apos;t enter a real card number; the details below never leave your browser.</Alert>
                <div className="mt-4 inline-flex rounded-lg border border-border p-1 text-sm">
                  <button type="button" onClick={() => setMethod("DEMO_CARD")} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5", method === "DEMO_CARD" ? "bg-subtle font-medium" : "text-muted")}><CreditCard className="h-4 w-4" /> Card</button>
                  <button type="button" onClick={() => setMethod("DEMO_PAYPAL")} className={cn("rounded-md px-3 py-1.5", method === "DEMO_PAYPAL" ? "bg-subtle font-medium" : "text-muted")}>PayPal</button>
                </div>
                {method === "DEMO_CARD" ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Name on card" htmlFor="cc-name" className="sm:col-span-2"><Input id="cc-name" value={card.holder} onChange={(e) => setCard((c) => ({ ...c, holder: e.target.value }))} autoComplete="off" /></Field>
                    <Field label="Card number (demo)" htmlFor="cc-num" className="sm:col-span-2"><Input id="cc-num" value={card.number} onChange={(e) => setCard((c) => ({ ...c, number: e.target.value }))} autoComplete="off" inputMode="numeric" /></Field>
                    <Field label="Expiry" htmlFor="cc-exp"><Input id="cc-exp" value={card.expiry} onChange={(e) => setCard((c) => ({ ...c, expiry: e.target.value }))} autoComplete="off" /></Field>
                    <Field label="CVC" htmlFor="cc-cvc"><Input id="cc-cvc" value={card.cvc} onChange={(e) => setCard((c) => ({ ...c, cvc: e.target.value }))} autoComplete="off" /></Field>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg bg-subtle p-4 text-sm text-muted">You&apos;ll confirm with PayPal (simulated in demo mode — no PayPal window opens and nothing is charged).</p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-5 text-sm">
                <div className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-accent" /> No card needed for the Free plan</div>
                <p className="mt-1 text-muted">Test every feature on 5 real businesses a month. Upgrade any time from Settings → Plan & billing.</p>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-surface p-5">
              <div className="mb-2 text-sm font-semibold">Included in every plan</div>
              <ul className="grid gap-1.5 text-sm text-muted sm:grid-cols-2">{PLAN_FEATURES.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{f}</li>)}</ul>
            </div>
          </div>

          <div className="h-fit rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-6">
            <div className="text-sm font-semibold">Order summary</div>
            <div className="mt-3 flex justify-between text-sm"><span>{plan.name} plan ({cycle === "YEARLY" ? "yearly" : "monthly"})</span><span className="font-medium">{amount === 0 ? "$0" : money(amount)}</span></div>
            <div className="mt-1 text-xs text-muted">{leadsLabel(plan)}</div>
            {cycle === "YEARLY" && plan.monthlyCents > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-emerald-700 dark:text-emerald-400">
                <li>You save {money(deal.saving)} ({deal.percent}%) vs monthly</li>
                {YEARLY_BENEFITS.slice(1).map((b) => <li key={b}>✓ {b}</li>)}
              </ul>
            )}
            <div className="my-4 border-t border-border" />
            <div className="flex justify-between text-base font-semibold"><span>Due today</span><span>{amount === 0 ? "$0" : `${money(amount)}${currency}`}</span></div>
            <div className="mt-1 text-xs text-muted">{amount === 0 ? "Free forever. No card required." : cycle === "YEARLY" ? "Renews yearly. Cancel any time." : "Renews monthly. Cancel any time."}</div>
            {usePayPal && canManage && !(isCurrent && hasWorkspace) ? (
              <div className="mt-5">
                {busy && <div className="flex h-11 items-center justify-center rounded-md bg-subtle text-sm text-muted">Activating your plan…</div>}
                {/* kept mounted while activating: PayPal is still finishing its approval callback */}
                <div className={busy ? "hidden" : undefined}><PayPalButtons clientId={paypal!.clientId} currency={paypal!.currency} handlers={paypalHandlers} /></div>
              </div>
            ) : (
              <Button type="submit" className="mt-5 h-11 w-full text-base" loading={busy} loadingText={amount > 0 ? "Processing payment…" : "Starting…"} disabled={!canManage || (isCurrent && hasWorkspace)}>
                {isCurrent && hasWorkspace ? "This is your current plan" : amount === 0 ? "Start free" : `Pay ${money(amount)} (demo)`}
              </Button>
            )}
            {hasWorkspace && <Link href={onboardingDone ? "/dashboard" : "/onboarding"} className="mt-3 block text-center text-xs text-muted hover:text-fg">Keep my current plan</Link>}
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 pb-16">
      <header className="mx-auto flex max-w-6xl items-center justify-between py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">W</span> WebScout AI</Link>
        <ol className="hidden items-center gap-2 text-xs text-muted md:flex">
          {STEPS.map((s, i) => <li key={s} className={cn("flex items-center gap-2", i <= step && "text-fg")}><span className={cn("flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", i < step ? "border-emerald-500 bg-emerald-500 text-white" : i === step ? "border-accent text-accent" : "border-border")}>{i < step ? "✓" : i + 1}</span>{s}{i < STEPS.length - 1 && <span className="text-faint">—</span>}</li>)}
        </ol>
      </header>
      {children}
    </div>
  );
}
