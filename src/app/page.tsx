import Link from "next/link";
import { ArrowRight, BarChart3, Check, FileCode2, Gauge, Inbox, Mail, MapPinned, MessageSquareReply, Phone, Rocket, Search, ShieldCheck, Sparkles, Target } from "lucide-react";
import { getSessionUser } from "@/lib/server/auth";
import { paypalConfig } from "@/lib/server/paypal";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingTable } from "@/components/marketing/pricing-table";

export const metadata = { title: "WebScout AI — find businesses that need a website and win them as clients" };
export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Search, title: "Find", text: "Search a radius up to 500 km — or whole cities, provinces and countries — for the kind of businesses you build for. Chains and landmarks are filtered out; small local businesses stay in." },
  { icon: Gauge, title: "Analyse", text: "Every website is checked automatically: missing, broken, outdated, not mobile-friendly, no booking or quote form. Each business gets an explainable opportunity score." },
  { icon: Mail, title: "Pitch", text: "Get a personalised email built from what was actually found on their site, a phone script, a quote from your own prices and a detailed website prompt — ready in seconds." },
  { icon: MessageSquareReply, title: "Win", text: "Replies land in one inbox with AI-drafted answers for your approval. Follow-ups, pipeline stages and reminders keep every conversation moving until it's a signed client." },
];

const FEATURES = [
  { icon: MapPinned, title: "Business Finder", text: "No 50 km limit. Big areas are split into zones automatically, so you find thousands of businesses, not one search's 60 results." },
  { icon: Rocket, title: "AutoProspect", text: "One button: discover, research, find public emails, analyse websites, write prompts and drafts. Runs in the background — close the browser." },
  { icon: Gauge, title: "Website audits", text: "Design, speed, mobile, SEO, trust and conversion checks with plain-language findings you can quote to the owner." },
  { icon: Target, title: "Opportunity scoring", text: "Know who needs you most. Businesses with no site or a broken one rise to the top of your list." },
  { icon: Mail, title: "Business email finder", text: "Finds emails publicly listed on each business's own site, records where it was found and checks it can receive mail. Never guesses." },
  { icon: FileCode2, title: "AI website prompts", text: "A detailed, business-specific build spec you can paste into any AI website builder — pages, copy, features, SEO." },
  { icon: Phone, title: "Call scripts & quotes", text: "No email? Call with a script built from their own website's problems, and quote from your real price list." },
  { icon: Inbox, title: "Inbox with AI replies", text: "Every reply is read, sorted and answered in draft — spam and newsletters filtered out automatically." },
  { icon: BarChart3, title: "CRM, exports & analytics", text: "Pipeline board, campaigns, follow-ups and polished PDF / Excel reports for every list you build." },
];

const FAQ = [
  { q: "What counts as a lead?", a: "A new business that WebScout discovers for you in a month. Businesses you add yourself or import from your own list never count, and re-finding a business you already have is free." },
  { q: "Do I need my own API keys?", a: "You connect a free Google Gemini key for the AI features (about two minutes at Google AI Studio) and your Gmail for sending. A Google Places key is optional: without one, searches use free OpenStreetMap data. The setup screen walks you through each step." },
  { q: "Is outreach compliant with anti-spam law?", a: "WebScout records where each email was found and the consent basis for contacting it, honours no-solicitation notices, adds a one-click unsubscribe link to every message and keeps a suppression list. By default nothing is sent without your approval." },
  { q: "Can I change or cancel my plan?", a: "Yes — upgrade, downgrade or switch to Free at any time from Settings → Plan & billing. Your leads and data stay with you." },
  { q: "What do I get on the Free plan?", a: "Everything. The Free plan has every feature — it's limited to 5 new leads a month so you can test the whole workflow on real businesses before you pay." },
  { q: "Who is WebScout for?", a: "Freelance web designers, small agencies and anyone who sells websites, redesigns or website care plans to local businesses." },
];

export default async function Home() {
  const loggedIn = Boolean(await getSessionUser().catch(() => null));
  const start = loggedIn ? "/dashboard" : `/signup?next=${encodeURIComponent("/checkout?plan=FREE")}`;
  return (
    <MarketingShell loggedIn={loggedIn}>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.18),transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted"><Sparkles className="h-3.5 w-3.5 text-accent" /> For web designers, freelancers & agencies</div>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Find businesses that need a website. <span className="text-accent">Win them as clients.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-muted">WebScout AI searches whole cities, provinces and countries for local businesses, checks their websites, finds their public contact details, writes personalised outreach and drafts your replies — so you spend your time closing deals, not hunting for them.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={start} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-fg shadow-lg shadow-accent/20 hover:opacity-90">{loggedIn ? "Open your dashboard" : "Start free — 5 leads a month"} <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/pricing" className="inline-flex h-12 items-center rounded-xl border border-border bg-surface px-6 text-base font-semibold hover:bg-subtle">See pricing</Link>
            </div>
            <p className="mt-3 text-sm text-faint">No credit card for the Free plan · Every feature included · Cancel any time</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between text-xs text-faint"><span>Example lead</span><span>Business Finder → Audit → Outreach</span></div>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-semibold">Maple Family Dental</div><div className="text-xs text-muted">Dentist · Mississauga · ★ 4.7 (128)</div></div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Opportunity 84</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li className="flex gap-2"><span className="text-red-500">●</span> No online booking — patients must call</li>
                <li className="flex gap-2"><span className="text-amber-500">●</span> Not mobile-friendly · last updated 2016</li>
                <li className="flex gap-2"><span className="text-emerald-500">●</span> Public email found on their contact page</li>
              </ul>
            </div>
            <div className="mt-3 rounded-xl bg-subtle p-4 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Personalised draft</div>
              <p className="mt-1.5 text-muted">“Hi — I noticed patients can&apos;t book online on Maple Family Dental&apos;s site, and it&apos;s hard to use on a phone. A simple booking page could save your front desk a lot of calls. Would a quick mock-up be useful?”</p>
            </div>
            <div className="mt-3 flex gap-2 text-xs"><span className="rounded-full bg-accent/10 px-2.5 py-1 font-medium text-accent">Draft ready for approval</span><span className="rounded-full bg-subtle px-2.5 py-1 text-muted">Call script & quote ready</span></div>
          </div>
        </div>
      </section>

      {/* Goal */}
      <section className="border-y border-border bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-3">
          <div className="md:col-span-1">
            <div className="text-sm font-semibold uppercase tracking-wide text-accent">Our goal</div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Every local business deserves a website that brings in customers.</h2>
          </div>
          <div className="space-y-4 text-muted md:col-span-2">
            <p>Plenty of small businesses still have no website, a broken one, or one that loses customers on a phone — and most owners don&apos;t know it. You can fix that. The hard part has always been finding them, checking each site, finding who to contact and writing something personal enough to get a reply.</p>
            <p>WebScout does that research for you, at scale, and turns it into conversations. You bring the skills; it brings you the businesses that need them — with the evidence to show them why.</p>
            <ul className="grid gap-2 pt-2 sm:grid-cols-3">
              {["Fill your pipeline every week", "Pitch with real evidence, not templates", "Spend your time on paid work"].map((t) => <li key={t} className="flex gap-2 text-sm font-medium text-fg"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{t}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <div className="text-center"><div className="text-sm font-semibold uppercase tracking-wide text-accent">How it gets you clients</div><h2 className="mt-2 text-3xl font-bold tracking-tight">From search to signed client in four steps</h2></div>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><s.icon className="h-5 w-5" /></span><span className="text-xs font-semibold text-faint">STEP {i + 1}</span></div>
              <div className="mt-4 text-lg font-semibold">{s.title}</div>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AutoProspect */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-800 px-6 py-12 text-white sm:px-12">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-100">AutoProspect</div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">One click. Your whole prospecting day — done.</h2>
              <p className="mt-3 text-emerald-50">Pick a region and the kinds of businesses you want. AutoProspect discovers them, finds public emails, analyses every website, writes a personalised email and website prompt for each — and queues them for your approval. It keeps working after you close the browser.</p>
            </div>
            <ol className="grid gap-2 text-sm sm:grid-cols-2">
              {["Discover businesses across regions", "Find public business emails", "Analyse every website", "Score the opportunity", "Write personalised outreach", "Queue for your approval"].map((t, i) => <li key={t} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3"><span className="font-bold">{i + 1}</span>{t}</li>)}
            </ol>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <div className="text-center"><div className="text-sm font-semibold uppercase tracking-wide text-accent">What it can do for you</div><h2 className="mt-2 text-3xl font-bold tracking-tight">Everything between “who should I contact?” and “we have a deal”</h2></div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-surface p-6">
              <f.icon className="h-6 w-6 text-accent" />
              <div className="mt-3 font-semibold">{f.title}</div>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Built-in anti-spam compliance: consent records, unsubscribe links, suppression list and human approval by default.</div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-border bg-surface/60">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <div className="text-center"><div className="text-sm font-semibold uppercase tracking-wide text-accent">Pricing</div><h2 className="mt-2 text-3xl font-bold tracking-tight">Start free. Upgrade when the clients start coming in.</h2><p className="mt-3 text-muted">Every plan has every feature — you only choose how many new leads you need each month.</p></div>
          <div className="mt-10"><PricingTable loggedIn={loggedIn} currency={paypalConfig().currency} /></div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight">Questions</h2>
        <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-surface">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}<span className="float-right text-muted transition-transform group-open:rotate-45">+</span></summary>
              <p className="mt-2 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="rounded-3xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
          <h2 className="text-3xl font-bold tracking-tight">Your next clients are already out there.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Find them, show them what their website is costing them, and start the conversation — today.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={start} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 font-semibold text-accent-fg hover:opacity-90">{loggedIn ? "Open your dashboard" : "Start free"} <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/pricing" className="inline-flex h-12 items-center rounded-xl border border-border px-6 font-semibold hover:bg-subtle">Compare plans</Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
