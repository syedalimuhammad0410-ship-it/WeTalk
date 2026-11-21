"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, ImageOff } from "lucide-react";
import { Badge, Card, CardHeader } from "../ui/misc";
import { ButtonLink } from "../ui/button";
import { LiveMap } from "../map/live-map";
import type { LeadData } from "./types";

const LABELS: Record<string, string> = {
  summary: "What they do", services: "Services", online_booking: "Online booking", contact_form: "Contact form", employees: "Team size", team_size: "Team size",
  locations: "Locations", years_in_business: "Years in business", founded: "Founded", owner: "Owner", revenue: "Revenue", annual_revenue: "Revenue", size: "Size",
  competitor: "Competitor", competitors: "Competitors", opportunity: "Opportunity", recommended_next_action: "Recommended next step", next_action: "Recommended next step",
};
const label = (f: string) => LABELS[f] ?? f.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/** Photos, a 3D-capable location map, size/revenue signals and Claude's sourced research for one lead. */
export function LeadProfileCard({ data }: { data: LeadData }) {
  const b = data.business;
  const ev = useMemo(() => data.evidence ?? [], [data.evidence]);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const photos = useMemo(() => {
    const list = [b.imageUrl, ...ev.filter((e) => /photo|image|logo/.test(e.field)).map((e) => e.value)].filter((u): u is string => Boolean(u) && /^https?:\/\//.test(u as string));
    return [...new Set(list)].filter((u) => !broken.has(u)).slice(0, 4);
  }, [b.imageUrl, ev, broken]);
  const facts = ev.filter((e) => e.kind === "FACT" && e.field !== "listing" && !/photo|image|logo/.test(e.field));
  const estimates = ev.filter((e) => e.kind === "ESTIMATE");
  const sources = [...new Set(ev.filter((e) => e.field === "listing" && e.sourceUrl).map((e) => e.sourceUrl!))];
  const pick = (re: RegExp) => ev.find((e) => re.test(e.field));
  const size = pick(/^size$|company_size|business_size/);
  const team = pick(/employees|team_size|staff/);
  const revenue = ev.find((e) => /revenue|turnover/.test(e.field) && e.kind === "FACT" && e.sourceUrl);
  const sizeGuess = b.reviewCount == null ? null : b.reviewCount < 150 ? "Small — likely a single location" : b.reviewCount < 1500 ? "Small to medium" : "Medium to large";
  const point = b.latitude != null && b.longitude != null ? [{ id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, category: b.category, city: [b.city, b.region].filter(Boolean).join(", "), address: b.address, website: b.website, phone: b.phone, imageUrl: b.imageUrl, score: b.opportunityScore, websiteClass: b.websiteClass, rating: b.rating, reviews: b.reviewCount }] : [];

  return (
    <Card>
      <CardHeader
        title="Profile"
        description="Photos, location and research. Facts link to their source; estimates are labelled."
        action={<ButtonLink size="sm" variant="outline" href={`/claude?leads=${b.id}`}><Bot className="h-4 w-4" /> Research with Claude</ButtonLink>}
      />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
        <div className="space-y-3">
          {photos.length ? (
            <div className={photos.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
              {photos.map((u, i) => (
                <img key={u} src={u} alt={i === 0 ? `${b.name}` : ""} referrerPolicy="no-referrer" loading="lazy" className={`w-full rounded-lg border border-border object-cover ${photos.length > 1 ? "h-28" : "h-48"}`} onError={() => setBroken((s) => new Set(s).add(u))} />
              ))}
            </div>
          ) : (
            <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted"><ImageOff className="h-5 w-5" /> No photos yet — added from their website or Claude&apos;s research</div>
          )}
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">Size</dt><dd>{size ? <>{size.value} {size.kind === "ESTIMATE" && <Badge tone="zinc">estimate</Badge>}</> : sizeGuess ? <>{sizeGuess} <Badge tone="zinc">estimate from reviews</Badge></> : <span className="text-faint">Unknown</span>}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">Team size</dt><dd>{team ? <>{team.value} {team.kind === "ESTIMATE" ? <Badge tone="zinc">estimate</Badge> : team.sourceUrl && <a href={team.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">source</a>}</> : <span className="text-faint">Not published</span>}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">Revenue</dt><dd>{revenue ? <>{revenue.value} <a href={revenue.sourceUrl!} target="_blank" rel="noreferrer noopener" className="text-xs text-accent hover:underline">source</a></> : <span className="text-faint">Not published — small private businesses rarely disclose it</span>}</dd></div>
          </dl>
        </div>
        <div>
          {point.length ? <LiveMap points={point} height={260} /> : <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed border-border px-6 text-center text-xs text-muted">No map location yet — add a street address to place this business on the map.</div>}
        </div>
      </div>

      {(facts.length > 0 || estimates.length > 0 || sources.length > 0) && (
        <div className="grid gap-4 border-t border-border px-5 py-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Verified facts</div>
            {facts.length === 0 ? <p className="text-sm text-faint">None yet.</p> : (
              <ul className="space-y-2 text-sm">
                {facts.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    <span className="font-medium">{label(f.field)}:</span> {f.value}
                    <span className="ml-1.5 inline-flex flex-wrap items-center gap-1.5 text-xs">
                      {f.verified && <span className="inline-flex items-center gap-0.5 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> found on page</span>}
                      {f.sourceUrl && <a href={f.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-accent hover:underline">{host(f.sourceUrl)} <ExternalLink className="h-3 w-3" /></a>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">AI estimates & suggestions</div>
            {estimates.length === 0 ? <p className="text-sm text-faint">None yet.</p> : (
              <ul className="space-y-2 text-sm">
                {estimates.slice(0, 12).map((f) => <li key={f.id}><span className="font-medium">{label(f.field)}:</span> {f.value} <Badge tone="zinc">estimate</Badge></li>)}
              </ul>
            )}
            {sources.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sources</div>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{sources.slice(0, 10).map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{host(u)}</a></li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
