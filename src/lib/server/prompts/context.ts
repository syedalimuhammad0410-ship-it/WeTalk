import "../guard";
import type { Business, Opportunity, WebsiteAudit, WebsiteFinding } from "@prisma/client";
import { db } from "../../db";
import { AppError } from "../errors";
import { classifyBusinessType } from "../intel/classify-type";
import { FEATURES } from "../intel/features";
import { computeOpportunity, type OpportunityReason, type RecommendedFeature } from "../intel/opportunity";
import { getPlaybook, type Playbook } from "../intel/playbooks";
import type { ExtractedFacts } from "../audit/service";
import { sourceLabel } from "../leads";

export type Fact = { label: string; value: string; source: string };
export type PromptOptions = {
  detail?: "concise" | "standard" | "detailed";
  addFeatures?: string[];
  removeFeatures?: string[];
  extraInstructions?: string;
};

export type PromptContext = {
  business: Business;
  playbook: Playbook;
  location: string | null;
  city: string | null;
  facts: Fact[];
  unknowns: string[];
  servicesVerified: { name: string; evidence: string }[];
  differentiators: { claim: string; evidence: string }[];
  audit: (WebsiteAudit & { findings: WebsiteFinding[] }) | null;
  extracted: ExtractedFacts | null;
  opportunityScore: number;
  opportunityReasons: OpportunityReason[];
  features: RecommendedFeature[];
  options: Required<Omit<PromptOptions, "extraInstructions">> & { extraInstructions: string };
  generatedAt: Date;
};

export async function loadPromptContext(workspaceId: string, businessId: string, options: PromptOptions = {}): Promise<PromptContext> {
  const business = await db.business.findFirst({ where: { id: businessId, workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  const [audit, opportunity] = await Promise.all([
    db.websiteAudit.findFirst({ where: { businessId, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, include: { findings: true } }),
    db.opportunity.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } }),
  ]);
  return buildPromptContext(business, audit, opportunity, options);
}

export function buildPromptContext(
  business: Business,
  audit: (WebsiteAudit & { findings: WebsiteFinding[] }) | null,
  opportunity: Opportunity | null,
  options: PromptOptions = {},
): PromptContext {
  const playbook = getPlaybook(business.businessType ?? classifyBusinessType({ category: business.category, name: business.name }).playbook.id);
  const extracted = (audit?.extracted ?? null) as ExtractedFacts | null;
  const src = business.source === "GOOGLE_PLACES" ? `Google Places listing${business.sourceFetchedAt ? `, retrieved ${business.sourceFetchedAt.toISOString().slice(0, 10)}` : ""}` : sourceLabel(business.source);
  const facts: Fact[] = [];
  const unknowns: string[] = [];
  const push = (label: string, value: string | null | undefined, source: string, unknownNote?: string) => {
    if (value && String(value).trim()) facts.push({ label, value: String(value).trim(), source });
    else unknowns.push(unknownNote ?? label);
  };
  const location = [business.city, business.region].filter(Boolean).join(", ") || null;
  push("Business name", business.name, src);
  push("Category (as listed)", business.category, src);
  push("Address", business.address, src);
  push("City / region", location, src);
  push("Phone", business.phone, business.phone && extracted?.phones?.includes(business.phone) ? "Website" : src);
  push("Email", business.email, business.emailSource ?? src, "Public business email");
  if (business.website) facts.push({ label: "Current website", value: business.website, source: src });
  if (business.rating != null) facts.push({ label: "Public rating", value: `${business.rating.toFixed(1)} from ${business.reviewCount ?? "?"} reviews`, source: `${src} (do not display on the new site unless the business approves and it complies with review-platform terms)` });
  if (business.hours.length) facts.push({ label: "Opening hours", value: business.hours.join("; "), source: `${src} — re-confirm with the owner before publishing` });
  else unknowns.push("Opening hours");
  const socials = Object.entries((business.socialLinks ?? {}) as Record<string, string>);
  if (socials.length) facts.push({ label: "Social profiles", value: socials.map(([k, v]) => `${k}: ${v}`).join(", "), source: "Website / listing" });
  if (extracted?.title) facts.push({ label: "Current site title", value: extracted.title, source: audit?.finalUrl ?? "Website" });
  if (extracted?.metaDescription) facts.push({ label: "Current site description", value: extracted.metaDescription, source: audit?.finalUrl ?? "Website" });
  if (extracted?.ai?.tagline) facts.push({ label: "Tagline (own words)", value: extracted.ai.tagline, source: audit?.finalUrl ?? "Website" });
  if (extracted?.address && !business.address) facts.push({ label: "Address on website", value: extracted.address, source: audit?.finalUrl ?? "Website" });
  if (extracted?.hours && !business.hours.length) facts.push({ label: "Hours text on website", value: extracted.hours, source: `${audit?.finalUrl ?? "Website"} — confirm` });
  if (extracted?.platform) facts.push({ label: "Current website platform", value: extracted.platform, source: "Detected from site code" });

  const servicesVerified = extracted?.ai?.services ?? [];
  if (!servicesVerified.length) unknowns.push("Confirmed list of services/products offered");
  unknowns.push("Prices / packages", "Testimonials with permission to publish", "Real photography", "Logo and brand colours", "Licences, certifications, awards (if any)", "Team members and roles", "Business history / founding year");

  let opportunityScore = opportunity?.score ?? 0;
  let opportunityReasons = (opportunity?.reasons ?? []) as unknown as OpportunityReason[];
  let features = (opportunity?.recommendedFeatures ?? []) as unknown as RecommendedFeature[];
  if (!opportunity) {
    const computed = computeOpportunity({
      playbook,
      websiteState: business.website ? "BLOCKED" : "NONE",
      classification: business.website ? null : "NO_WEBSITE",
      overall: null,
      scores: null,
      features: null,
      https: null,
      business,
    });
    opportunityScore = computed.score;
    opportunityReasons = computed.reasons;
    features = computed.recommended.map((f) => ({ ...f, status: business.website ? "unknown" : "missing" }));
  }

  const remove = new Set(options.removeFeatures ?? []);
  features = features.filter((f) => !remove.has(f.key));
  for (const key of options.addFeatures ?? []) {
    if (!features.some((f) => f.key === key)) {
      const def = FEATURES[key];
      if (def) features.push({ key, name: def.name, priority: "recommended", why: `${def.why} (Added on request.)`, status: "unknown" });
    }
  }

  return {
    business,
    playbook,
    location,
    city: business.city,
    facts,
    unknowns: Array.from(new Set(unknowns)),
    servicesVerified,
    differentiators: extracted?.ai?.differentiators ?? [],
    audit,
    extracted,
    opportunityScore,
    opportunityReasons,
    features,
    options: {
      detail: options.detail ?? "detailed",
      addFeatures: options.addFeatures ?? [],
      removeFeatures: options.removeFeatures ?? [],
      extraInstructions: options.extraInstructions ?? "",
    },
    generatedAt: new Date(),
  };
}
