import type { WebsiteClassT } from "../audit/classify";
import type { FeaturePresence } from "../audit/score";
import { FEATURES } from "./features";
import type { Playbook } from "./playbooks";

export type OpportunityReason = { label: string; points: number; kind: "VERIFIED" | "INFERRED" };
export type RecommendedFeature = { key: string; name: string; priority: string; why: string; status: "missing" | "present" | "unknown" };

export type OpportunityInput = {
  playbook: Playbook;
  websiteState: "NONE" | "SOCIAL_ONLY" | "UNAVAILABLE" | "BLOCKED" | "ANALYSED";
  classification: WebsiteClassT | null;
  overall: number | null;
  scores: Partial<Record<string, number>> | null;
  features: FeaturePresence[] | null;
  https: boolean | null;
  business: { phone?: string | null; address?: string | null; rating?: number | null; reviewCount?: number | null; operationalStatus?: string | null };
};

/**
 * Opportunity score (0–100): how much a better website could plausibly help
 * this business. Every point is attributable to a stated reason. This is a
 * prioritisation aid, not a prediction of revenue.
 */
export function computeOpportunity(i: OpportunityInput) {
  const reasons: OpportunityReason[] = [];
  const add = (label: string, points: number, kind: OpportunityReason["kind"] = "INFERRED") => {
    if (points !== 0) reasons.push({ label, points: Math.round(points), kind });
  };

  if (i.business.operationalStatus && /CLOSED/i.test(i.business.operationalStatus)) {
    add(`Listing status is ${i.business.operationalStatus.replace(/_/g, " ").toLowerCase()}`, -100, "VERIFIED");
  }

  switch (i.websiteState) {
    case "NONE":
      add("No website detected in available sources", 60, "VERIFIED");
      break;
    case "SOCIAL_ONLY":
      add("Only a social-media/directory profile is listed as the website", 55, "VERIFIED");
      break;
    case "UNAVAILABLE":
      add("Listed website could not be loaded", 55, "VERIFIED");
      break;
    case "BLOCKED":
      add("Website could not be analysed automatically (manual review needed)", 5, "VERIFIED");
      break;
    case "ANALYSED": {
      if (i.classification === "INCOMPLETE") add("Website appears incomplete or placeholder", 35, "VERIFIED");
      if (i.classification === "BROKEN") add("Website is broken", 40, "VERIFIED");
      if (i.classification === "OUTDATED") add("Website shows multiple outdated signals", 22, "VERIFIED");
      if (i.overall != null && i.overall < 70) add(`Website quality score ${i.overall}/100`, (70 - i.overall) * 0.45, "VERIFIED");
      if ((i.scores?.mobile ?? 100) < 50) add(`Weak mobile experience (${i.scores?.mobile}/100)`, 8, "VERIFIED");
      if ((i.scores?.conversion ?? 100) < 50) add(`Few conversion paths (${i.scores?.conversion}/100)`, 8, "VERIFIED");
      if (i.https === false) add("No HTTPS", 6, "VERIFIED");
      const missingEssential = (i.features ?? []).filter((f) => f.priority === "essential" && !f.present);
      if (missingEssential.length) add(`Missing essential features: ${missingEssential.map((f) => f.name).join(", ")}`, Math.min(24, missingEssential.length * 6), "INFERRED");
      if (i.classification === "SINGLE_PAGE" && missingEssential.length) add("Single-page site without the conversion features this business type typically needs", 5, "INFERRED");
      if (i.classification === "EXCELLENT") add("Current website is already excellent", -25, "VERIFIED");
      if (i.classification === "STRONG") add("Current website is already strong", -12, "VERIFIED");
      break;
    }
  }

  add(`${i.playbook.label} businesses rely heavily on their website for ${i.playbook.primaryConversion.toLowerCase()}`, i.playbook.webDependence * 10, "INFERRED");
  if ((i.business.reviewCount ?? 0) >= 20) add(`Established local demand (${i.business.reviewCount} public reviews)`, 5, "VERIFIED");
  else if ((i.business.reviewCount ?? 0) >= 5) add(`Active listing (${i.business.reviewCount} public reviews)`, 2, "VERIFIED");
  if (i.business.phone && i.business.address) add("Complete public contact details (easy to reach)", 2, "VERIFIED");

  const raw = reasons.reduce((s, r) => s + r.points, 0);
  let score = Math.max(0, Math.min(100, Math.round(raw)));
  if (i.classification === "EXCELLENT") score = Math.min(score, 25);

  const recommended: RecommendedFeature[] = i.playbook.features.map((ref) => {
    const p = i.features?.find((f) => f.key === ref.key);
    const def = FEATURES[ref.key]!;
    return {
      key: ref.key,
      name: def.name,
      priority: ref.priority,
      why: ref.why ?? def.why,
      status: i.websiteState === "ANALYSED" ? (p?.present ? "present" : "missing") : i.websiteState === "BLOCKED" ? "unknown" : "missing",
    };
  });

  const top = [...reasons].filter((r) => r.points > 0).sort((a, b) => b.points - a.points).slice(0, 3).map((r) => r.label.toLowerCase());
  const summary =
    score >= 70
      ? `High potential opportunity: ${top.join("; ")}.`
      : score >= 45
        ? `Moderate potential opportunity: ${top.join("; ")}.`
        : `Limited opportunity${top.length ? `: ${top.join("; ")}` : ""}.`;

  return { score, reasons: reasons.sort((a, b) => b.points - a.points), recommended, summary };
}
