import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Privacy & Responsible Research" };

const RULES: [string, string][] = [
  ["Public places, not private people", "TRACE identifies public places, venues, buildings, organizations, objects, events and documents. It has no facial recognition and never tries to identify private individuals. Person detections are counted and ignored."],
  ["No tracking", "TRACE won't track anyone's movements, reconstruct where a person has been, or connect people to locations over time."],
  ["Buildings without residents", "For apartment or office buildings, TRACE may identify a publicly identifiable building or address. It won't look up, infer or display information about residents, tenants or occupants."],
  ["Public figures", "A public figure is discussed only when the image itself clearly captions them and the information is already publicly documented."],
  ["Legitimate sources only", "TRACE uses official APIs and public datasets (Wikidata, Wikipedia, OpenStreetMap, Wikimedia Commons, GDELT, the Library of Congress, and configured commercial APIs). It does not scrape services that forbid it, bypass authentication, or access private databases."],
  ["No fabricated evidence", "Sources, URLs, search results, matches and locations come only from real retrieved records. Links TRACE could not verify are labelled. The assistant removes any citation that does not resolve to a real source."],
  ["Honest uncertainty", "Confidence is stated in plain words (high, moderate, low, insufficient) with reasons. Contradicting evidence is always shown. When the evidence is insufficient, TRACE says so and does not guess."],
  ["Your data", "Uploaded images are re-encoded, which strips embedded payloads and metadata. EXIF is read in your browser before upload so you can see it. Investigations are private to your account, and deleting one also deletes its images. API keys stay on the server and are never sent to the browser."],
];

export default function Privacy() {
  return (
    <main className="min-h-dvh bg-ink">
      <header className="flex items-center justify-between border-b border-line px-6 py-4 md:px-10">
        <Logo />
        <Link href="/app" className="text-[13px] text-dim hover:text-fg">
          Open TRACE →
        </Link>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-14">
        <div className="label-mono mb-3 text-cyan">Policy</div>
        <h1 className="mb-4 text-[34px] font-semibold tracking-tight">Privacy & Responsible Research</h1>
        <p className="mb-10 text-[15px] leading-relaxed text-dim">TRACE is for legitimate research into publicly available information. These rules are built into the product, not just stated here.</p>
        <ol className="space-y-px overflow-hidden rounded-card border border-line bg-line">
          {RULES.map(([t, b], i) => (
            <li key={t} className="flex gap-5 bg-panel p-5">
              <span className="label-mono pt-0.5 text-mute">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h2 className="mb-1 text-[15px] font-semibold">{t}</h2>
                <p className="text-[13.5px] leading-relaxed text-dim">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </article>
    </main>
  );
}
