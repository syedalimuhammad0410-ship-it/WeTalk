import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/misc";

export const metadata = { title: "Help" };

const sections: { id: string; title: string; body: React.ReactNode }[] = [
  { id: "workflow", title: "The workflow", body: <ol className="ml-5 list-decimal space-y-1"><li><b>Find businesses</b> through Google Places (or add/import manually).</li><li><b>Analyze websites</b> — explainable scores, classification and findings labelled Verified / Inferred / Unknown.</li><li><b>Review the opportunity</b> — every point has a reason.</li><li><b>Generate the website prompt</b> — a 5,000+ word, business-specific spec. Copy it into Claude Code, Lovable, Replit, Cursor or Gemini.</li><li><b>Write outreach</b> from verified observations; confirm before sending.</li><li><b>Handle replies</b> in the Inbox: AI classifies, drafts and you approve.</li><li><b>Follow up</b> automatically (bounded), and move leads through the pipeline.</li></ol> },
  { id: "factuality", title: "How WebScout avoids making things up", body: <ul className="ml-5 list-disc space-y-1"><li>Missing business data is shown as “Not found”, never guessed.</li><li>AI-extracted website facts must quote text that exists on the site, otherwise they are dropped.</li><li>AI-edited prompts are fact-checked: new phone numbers, prices, years, counts or ratings cause the revision to be discarded.</li><li>Generated prompts tell the website builder to use verified information only and to use placeholders like [VERIFY HOURS] and [ADD REAL TESTIMONIAL].</li><li>Outreach and reply drafts are scanned for prices, discounts, guarantees, deadlines and meeting times you haven’t configured.</li></ul> },
  { id: "automation", title: "AI response modes & safety", body: <><p><b>Manual</b>: AI analyses only. <b>Approval required</b> (default): AI drafts, a human approves. <b>Automatic</b>: AI may send qualifying replies.</p><p className="mt-2">Even in Automatic mode, messages involving legal matters, threats, complaints, refunds, payments, contracts, sensitive information, security issues, unknown requests, low confidence, hostility or unsubscribes always go to human review with the reason shown. Unsubscribe requests immediately set the lead to Do Not Contact and stop all automation.</p></> },
  { id: "email", title: "Email setup", body: <ul className="ml-5 list-disc space-y-1"><li><b>Gmail</b>: set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, add the redirect URI <code>{"{APP_URL}"}/api/auth/google/callback</code> in Google Cloud, enable the Gmail API, then Settings → Email → Gmail. Replies are polled every ~2 minutes.</li><li><b>Postmark</b>: add a server token and verified sender; copy the inbound webhook URL shown after connecting into Postmark’s inbound settings. Optionally set the inbound address for exact reply matching.</li><li><b>Sandbox</b>: records emails without delivering them, and lets you simulate replies.</li></ul> },
  { id: "discovery", title: "Business discovery", body: <p>Uses the official Places API (New) Text Search with a minimal field mask. Google returns at most 60 results per query; use comma-separated search terms to run several queries. Google does not provide email addresses — WebScout only uses emails publicly listed on the business’s own website or entered by you with a source.</p> },
  { id: "troubleshooting", title: "Troubleshooting", body: <ul className="ml-5 list-disc space-y-1"><li>“Connect … to enable this feature” — add the integration in Settings → Business Discovery &amp; AI keys or Email.</li><li>Quota / invalid key errors — see Admin → System health; nothing is partially saved without saying so.</li><li>Jobs stuck in “Queued” — the background runner isn’t running (see Admin → System health).</li><li>“Website blocked” — the site disallowed automated access (robots.txt, CAPTCHA, login). WebScout never bypasses these; review manually.</li></ul> },
];

export default function HelpPage() {
  return (
    <div>
      <PageHeader title="Help" description="How WebScout AI works, and how to configure it. Full setup docs live in the repository’s docs/ folder." />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="hidden space-y-1 lg:block" aria-label="Help sections">{sections.map((s) => <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-subtle hover:text-fg">{s.title}</a>)}</nav>
        <div className="space-y-4">
          {sections.map((s) => <Card key={s.id} id={s.id} className="prose-app scroll-mt-20 p-6"><h2 className="!mt-0">{s.title}</h2><div className="mt-3 space-y-2 text-sm leading-6 text-muted">{s.body}</div></Card>)}
          <p className="text-sm text-muted">Need to change setup? <Link href="/onboarding" className="text-accent hover:underline">Re-run the setup wizard</Link>.</p>
        </div>
      </div>
    </div>
  );
}
