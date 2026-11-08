import Link from "next/link";
import { getSessionUser } from "@/lib/server/auth";
import { paypalConfig } from "@/lib/server/paypal";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingTable } from "@/components/marketing/pricing-table";

export const metadata = { title: "Pricing — WebScout AI" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const loggedIn = Boolean(await getSessionUser().catch(() => null));
  return (
    <MarketingShell loggedIn={loggedIn}>
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Simple pricing that grows with your client list</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">Start free with 5 leads a month to test everything on real businesses. When WebScout starts bringing you clients, pick the plan that matches how fast you want to grow.</p>
        </div>
        <div className="mt-12"><PricingTable loggedIn={loggedIn} currency={paypalConfig().currency} /></div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {[
            ["What's a lead?", "A new business WebScout discovers for you in a month — with its website analysed and contact details checked. Businesses you add or import yourself are always free."],
            ["What do I need to set up?", "A free Google Gemini key for the AI, and your Gmail for sending. A Google Places key is optional — searches fall back to free OpenStreetMap data."],
            ["Can I switch plans?", "Any time, in Settings → Plan & billing. Upgrades apply immediately; your leads and data always stay with you."],
          ].map(([q, a]) => (
            <div key={q} className="rounded-2xl border border-border bg-surface p-6"><div className="font-semibold">{q}</div><p className="mt-2 text-sm text-muted">{a}</p></div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-muted">Questions? <Link href="/#faq" className="font-medium text-accent hover:underline">Read the FAQ</Link></p>
      </section>
    </MarketingShell>
  );
}
