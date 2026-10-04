import { REQUIRED_SECTIONS } from "./composer";
import type { PromptContext } from "./context";

export type QualityDimension =
  | "specificity"
  | "completeness"
  | "actionability"
  | "accuracy"
  | "featureRelevance"
  | "designDetail"
  | "technicalDetail"
  | "conversion"
  | "seo"
  | "mobile";

export const QUALITY_LABELS: Record<QualityDimension, string> = {
  specificity: "Business specificity",
  completeness: "Completeness",
  actionability: "Actionability",
  accuracy: "Accuracy",
  featureRelevance: "Feature relevance",
  designDetail: "Design detail",
  technicalDetail: "Technical detail",
  conversion: "Conversion strategy",
  seo: "SEO detail",
  mobile: "Mobile detail",
};

export type QualityReport = { score: number; dimensions: Record<QualityDimension, { score: number; notes: string[] }> };

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Deterministic rubric (10 dimensions × 10 points). Measures observable
 * properties of the prompt text so scores are explainable and repeatable.
 */
export function scorePrompt(text: string, ctx: Pick<PromptContext, "business" | "playbook" | "city" | "features" | "facts">): QualityReport {
  const t = text;
  const lower = t.toLowerCase();
  const d = {} as QualityReport["dimensions"];
  const set = (k: QualityDimension, parts: [boolean | number, number, string][]) => {
    let s = 0;
    const notes: string[] = [];
    for (const [ok, pts, note] of parts) {
      const r = typeof ok === "number" ? Math.max(0, Math.min(1, ok)) : ok ? 1 : 0;
      s += pts * r;
      if (r < 1) notes.push(note);
    }
    d[k] = { score: Math.round(Math.min(10, s) * 10) / 10, notes };
  };

  const nameHits = count(t, new RegExp(esc(ctx.business.name), "gi"));
  const cityHits = ctx.city ? count(t, new RegExp(esc(ctx.city), "gi")) : 0;
  const typeHits = count(lower, new RegExp(esc(ctx.playbook.label.toLowerCase()), "g"));
  set("specificity", [
    [nameHits / 12, 4, `Business name referenced only ${nameHits}× (target ≥ 12)`],
    [ctx.city ? cityHits / 6 : 0.5, 3, ctx.city ? `City referenced ${cityHits}× (target ≥ 6)` : "City unknown"],
    [typeHits / 5, 2, `Business type referenced ${typeHits}×`],
    [/verified|source:/i.test(t), 1, "No sourced facts"],
  ]);

  const presentSections = REQUIRED_SECTIONS.filter((s) => t.includes(s));
  set("completeness", [
    [presentSections.length / REQUIRED_SECTIONS.length, 8, `Missing sections: ${REQUIRED_SECTIONS.filter((s) => !t.includes(s)).join(", ")}`],
    [t.split(/\s+/).length / 3500, 2, `Only ${t.split(/\s+/).length} words (target ≥ 3500 for full detail)`],
  ]);

  const bulletCount = count(t, /^\s*- /gm);
  const checklist = count(t, /^\[ \]/gm);
  set("actionability", [
    [bulletCount / 180, 5, `${bulletCount} actionable bullet points (target ≥ 180)`],
    [checklist / 15, 3, `${checklist} acceptance criteria (target ≥ 15)`],
    [/BUILD ORDER/.test(t), 2, "No build order"],
  ]);

  const placeholders = count(t, /\[[A-Z][A-Z0-9 /&:—,'’.-]{3,}\]/g);
  set("accuracy", [
    [/use verified information only/i.test(t), 3, "Missing explicit ‘use verified information only’ rule"],
    [/never write fake testimonials/i.test(t), 2, "Missing fake-testimonial prohibition"],
    [placeholders / 25, 3, `${placeholders} labelled placeholders (target ≥ 25)`],
    [/UNKNOWN INFORMATION/.test(t), 2, "Unknowns not listed"],
  ]);

  const featureNames = ctx.features.map((f) => f.name);
  const featHits = featureNames.filter((n) => t.includes(n)).length;
  set("featureRelevance", [
    [featureNames.length ? featHits / featureNames.length : 0, 6, "Not all selected features are specified"],
    [/Why \(INFERRED\/RECOMMENDATION\)/.test(t), 2, "Feature rationale missing"],
    [count(t, /(ESSENTIAL|RECOMMENDED|OPTIONAL) \(/g) >= 3, 2, "Feature priorities missing"],
  ]);

  const designTerms = ["typography", "spacing", "layout", "buttons", "cards", "forms", "navigation", "icons", "imagery", "border radius", "visual hierarchy", "animation"];
  set("designDetail", [[designTerms.filter((x) => lower.includes(x)).length / designTerms.length, 7, "Design system topics missing"], [/--color-|token/i.test(t), 3, "No design tokens"]]);

  const techTerms = ["lcp", "cls", "inp", "lazy", "code splitting", "caching", "font-display", "content-security-policy", "rate limit", "environment variables", "sanitis", "wcag"];
  set("technicalDetail", [[techTerms.filter((x) => lower.includes(x)).length / techTerms.length, 10, "Technical topics missing"]]);

  set("conversion", [
    [lower.includes(ctx.playbook.primaryConversion.toLowerCase()), 3, "Primary conversion not referenced"],
    [count(t, /Primary CTA:/g) / 5, 3, "Per-page CTAs missing"],
    [/success state/i.test(t) && /error state/i.test(t) && /loading state/i.test(t), 2, "Form states incomplete"],
    [/analytics|conversion\)/i.test(t), 2, "Conversion tracking missing"],
  ]);

  set("seo", [
    [/<title>/i.test(t) || /Title tags/i.test(t), 2, "No title tag plan"],
    [/json-ld/i.test(t), 2, "No structured data"],
    [/local seo/i.test(t), 2, "No local SEO"],
    [/sitemap/i.test(t) && /robots\.txt/i.test(t), 2, "No sitemap/robots"],
    [/canonical/i.test(t) && /open graph/i.test(t), 2, "No canonical/OG"],
  ]);

  set("mobile", [
    [["phone (", "tablet (", "desktop (", "large desktop ("].filter((x) => lower.includes(x)).length / 4, 5, "Breakpoints incomplete"],
    [/sticky bottom action bar/i.test(t), 2, "No sticky mobile action bar"],
    [/tap targets|44px|48px/i.test(t), 2, "Tap target sizes not specified"],
    [/mobile behaviour:/i.test(t), 1, "Per-page mobile behaviour missing"],
  ]);

  const score = Math.round(Object.values(d).reduce((s, x) => s + x.score, 0));
  return { score, dimensions: d };
}

// ───────────── Fact guard (anti-hallucination for AI-edited prompts) ─────────────

const RISKY_PATTERNS: [string, RegExp][] = [
  ["phone number", /(?:\+?\d[\d\s().-]{8,}\d)/g],
  ["email address", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi],
  ["price", /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?)|(?:\d+(?:\.\d+)?\s?(?:dollars|usd|cad))/gi],
  ["year", /\b(?:since|established|founded|est\.?)\s+(?:in\s+)?(?:19|20)\d{2}\b/gi],
  ["years of experience", /\b\d{1,3}\+?\s+years?\b(?!\s+old)/gi],
  ["customer count", /\b\d{2,}[,\d]*\+?\s+(?:happy\s+)?(?:customers|clients|patients|projects|homes|jobs)\b/gi],
  ["rating", /\b[1-5](?:\.\d)?\s?(?:\/\s?5|stars?|★)/gi],
  ["percentage claim", /\b\d{1,3}%\s+(?:satisfaction|guarantee|success|off|discount)/gi],
];

/** Returns factual-looking tokens in `candidate` that do not appear in the trusted `source` text. */
export function findUnsupportedClaims(candidate: string, source: string): { type: string; value: string }[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s().-]/g, "");
  const src = norm(source);
  const out: { type: string; value: string }[] = [];
  for (const [type, re] of RISKY_PATTERNS) {
    for (const m of candidate.matchAll(re)) {
      const v = m[0].trim();
      if (type === "phone number" && v.replace(/\D/g, "").length < 10) continue;
      if (!src.includes(norm(v))) out.push({ type, value: v });
    }
  }
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.value) ? false : (seen.add(x.value), true))).slice(0, 20);
}
