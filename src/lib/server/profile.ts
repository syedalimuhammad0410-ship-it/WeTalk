import "./guard";
import { db } from "../db";
import { AppError } from "./errors";

/** Everything the live view's business drawer shows. Facts keep their sources; estimates are labelled. */
export async function businessProfile(workspaceId: string, id: string) {
  const b = await db.business.findFirst({ where: { id, workspaceId }, include: { contacts: { where: { email: { not: null } }, select: { email: true, role: true, eligibility: true, sourceUrl: true } } } });
  if (!b) throw new AppError("NOT_FOUND", "Business not found.");
  const [audit, opp, evidence] = await Promise.all([
    db.websiteAudit.findFirst({ where: { businessId: id, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { classification: true, overallScore: true, summary: true, extracted: true, createdAt: true } }),
    db.opportunity.findFirst({ where: { businessId: id }, orderBy: { createdAt: "desc" }, select: { score: true, summary: true, reasons: true, recommendedFeatures: true } }),
    db.businessEvidence.findMany({ where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 60, select: { field: true, value: true, kind: true, sourceUrl: true, verified: true } }),
  ]);
  const ai = (audit?.extracted as { ai?: { summary?: string; services?: { name: string }[] } | null } | null)?.ai ?? null;
  const pick = (f: string) => evidence.find((e) => e.field === f)?.value ?? null;
  const photos = [...new Set([b.imageUrl, ...evidence.filter((e) => /photo|image|logo/.test(e.field)).map((e) => e.value)].filter((u): u is string => Boolean(u) && /^https?:\/\//.test(u!)))].slice(0, 4);
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    whatTheyDo: pick("summary") ?? ai?.summary ?? null,
    services: pick("services") ?? (ai?.services?.length ? ai.services.map((s) => s.name).slice(0, 8).join(", ") : null),
    address: b.address,
    city: [b.city, b.region].filter(Boolean).join(", ") || null,
    phone: b.phone,
    website: b.website,
    email: b.email,
    rating: b.rating,
    reviews: b.reviewCount,
    lat: b.latitude,
    lng: b.longitude,
    status: b.status,
    doNotContact: b.doNotContact,
    photos,
    websiteRating: audit ? { label: (audit.classification ?? "").replace(/_/g, " ").toLowerCase() || null, score: audit.overallScore, summary: audit.summary } : b.websiteStatus === "NO_WEBSITE" ? { label: "no website", score: null, summary: null } : null,
    opportunity: opp ? { score: opp.score, summary: opp.summary } : b.opportunityScore != null ? { score: b.opportunityScore, summary: null } : null,
    contacts: b.contacts.map((c) => ({ email: c.email!, role: c.role, eligibility: c.eligibility, sourceUrl: c.sourceUrl })),
    facts: evidence.filter((e) => e.kind === "FACT" && !["listing", "summary", "services"].includes(e.field) && !/photo|image|logo/.test(e.field)).slice(0, 12),
    estimates: evidence.filter((e) => e.kind === "ESTIMATE").slice(0, 8),
    sources: [...new Set(evidence.filter((e) => e.field === "listing" && e.sourceUrl).map((e) => e.sourceUrl!))].slice(0, 6),
    discoveredAt: b.discoveredAt,
    source: ({ GOOGLE_PLACES: "Google Places", OPENSTREETMAP: "OpenStreetMap", CLAUDE_RESEARCH: "Claude research", MANUAL: "Added by hand", CSV_IMPORT: "CSV import", DEMO: "Demo data" } as Record<string, string>)[b.source] ?? b.source,
    hours: b.hours.slice(0, 7),
    social: Object.entries((b.socialLinks ?? {}) as Record<string, string>).filter(([, u]) => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 5).map(([k, u]) => ({ label: k, url: u })),
    // Why it's a good lead (verified reasons first) and what their website is missing.
    reasons: ((opp?.reasons ?? []) as { label: string; points: number; kind: string }[]).filter((r) => r.points > 0).sort((a, c) => (a.kind === "VERIFIED" ? -1 : 1) - (c.kind === "VERIFIED" ? -1 : 1) || c.points - a.points).slice(0, 4).map((r) => ({ label: r.label, verified: r.kind === "VERIFIED" })),
    missing: ((opp?.recommendedFeatures ?? []) as { name: string; status: string; priority: string }[]).filter((f) => f.status === "missing").slice(0, 5).map((f) => f.name),
  };
}
export type BusinessProfile = Awaited<ReturnType<typeof businessProfile>>;
