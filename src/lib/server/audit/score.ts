import "../guard";
import type { PageData } from "./analyze";
import { FEATURES } from "../intel/features";
import type { Playbook } from "../intel/playbooks";
import { SCORE_CATEGORIES, type ScoreCategory } from "../../constants";

export type Psi = {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  metrics: { lcpMs?: number; cls?: number; tbtMs?: number; fcpMs?: number; speedIndexMs?: number };
};

export type SiteData = {
  home: PageData;
  pages: PageData[];
  https: boolean;
  httpsRedirect: boolean;
  brokenLinks: { url: string; status: number | string }[];
  linksChecked: number;
  psi: Psi | null;
  city: string | null;
  now?: Date;
};

export type Check = { id: string; label: string; max: number; earned: number; passed: boolean; evidence: string };
export type Finding = { category: ScoreCategory; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "POSITIVE"; kind: "VERIFIED" | "INFERRED" | "UNKNOWN"; code: string; title: string; detail: string; evidence?: string };
export type FeaturePresence = { key: string; name: string; priority: "essential" | "recommended" | "optional"; present: boolean; evidence: string | null; why: string };

export const CATEGORY_WEIGHTS: Record<ScoreCategory, number> = {
  design: 0.12,
  performance: 0.12,
  mobile: 0.15,
  content: 0.13,
  conversion: 0.18,
  seo: 0.12,
  trust: 0.1,
  functionality: 0.08,
};

export function signalBlob(site: SiteData) {
  const all = [site.home, ...site.pages];
  return all
    .map((p) =>
      [
        p.url,
        p.title,
        p.h1.join(" "),
        p.h2.join(" "),
        p.h3.join(" "),
        p.text,
        p.internalLinks.map((l) => `${l.href} ${l.text}`).join(" "),
        p.externalLinks.join(" "),
        p.iframes.join(" "),
        p.ctaTexts.join(" "),
        p.telLinks.map((t) => `href="tel:${t}"`).join(" "),
      ].join(" \n "),
    )
    .join(" \n ");
}

export function detectFeatures(playbook: Playbook, site: SiteData): FeaturePresence[] {
  const blob = signalBlob(site);
  const all = [site.home, ...site.pages];
  const forms = all.flatMap((p) => p.forms).filter((f) => !["search", "login", "newsletter"].includes(f.purpose));
  return playbook.features.map((ref) => {
    const def = FEATURES[ref.key]!;
    let evidence: string | null = null;
    if (ref.key === "click_to_call") {
      const tel = all.flatMap((p) => p.telLinks)[0];
      evidence = tel ? `Tap-to-call link found (${tel})` : null;
    } else if (ref.key === "contact_form") {
      const f = forms.find((x) => x.fields.length >= 2);
      evidence = f ? `Form with ${f.fields.length} fields (${f.purpose})` : null;
    } else if (ref.key === "quote_request") {
      const f = forms.find((x) => x.purpose === "quote");
      if (f) evidence = `Quote form with ${f.fields.length} fields`;
      else {
        const m = def.detect.map((re) => blob.match(re)).find(Boolean);
        evidence = m && forms.length ? `Mentions “${m[0]}” and has a form` : m ? `Mentions “${m[0]}” (no structured form detected)` : null;
      }
    } else {
      for (const re of def.detect) {
        const m = blob.match(re);
        if (m) {
          evidence = `Found “${m[0].slice(0, 60)}”`;
          break;
        }
      }
    }
    return { key: ref.key, name: def.name, priority: ref.priority, present: Boolean(evidence), evidence, why: ref.why ?? def.why };
  });
}

function scoreCategory(checks: Check[]) {
  const max = checks.reduce((s, c) => s + c.max, 0);
  const earned = checks.reduce((s, c) => s + c.earned, 0);
  return max ? Math.round((earned / max) * 100) : 0;
}

const chk = (id: string, label: string, max: number, passed: boolean | number, evidence: string): Check => {
  const ratio = typeof passed === "number" ? Math.max(0, Math.min(1, passed)) : passed ? 1 : 0;
  return { id, label, max, earned: Math.round(max * ratio * 10) / 10, passed: ratio >= 0.999, evidence };
};

export function scoreSite(site: SiteData, features: FeaturePresence[]) {
  const h = site.home;
  const all = [h, ...site.pages];
  const year = (site.now ?? new Date()).getFullYear();
  const totalWords = all.reduce((s, p) => s + p.wordCount, 0);
  const imgTotal = all.reduce((s, p) => s + p.images.total, 0);
  const imgMissingAlt = all.reduce((s, p) => s + p.images.missingAlt, 0);
  const imgLazy = all.reduce((s, p) => s + p.images.lazy, 0);
  const imgModern = all.reduce((s, p) => s + p.images.modernFormat, 0);
  const imgLegacy = all.reduce((s, p) => s + p.images.legacyFormat, 0);
  const forms = all.flatMap((p) => p.forms).filter((f) => !["search", "login"].includes(f.purpose));
  const viewportOk = Boolean(h.viewport && /width\s*=\s*device-width/i.test(h.viewport));
  const fixedWidth = Boolean(h.viewport && /width\s*=\s*\d{3,}/i.test(h.viewport));
  const blob = signalBlob(site).toLowerCase();
  const city = site.city?.toLowerCase() ?? null;
  const essential = features.filter((f) => f.priority === "essential");
  const essentialPresent = essential.filter((f) => f.present).length;
  const conversionFeatureKeys = ["online_booking", "reservations", "quote_request", "online_ordering", "case_consultation", "enrollment", "rooms_booking", "class_schedule", "listings"];
  const primaryConversion = features.find((f) => conversionFeatureKeys.includes(f.key) && f.priority === "essential");
  const stale = h.copyrightYear != null && year - h.copyrightYear >= 3;

  const breakdown: Record<ScoreCategory, Check[]> = {
    design: [
      chk("design.viewport", "Responsive viewport configured", 15, viewportOk, viewportOk ? `viewport: ${h.viewport}` : "No device-width viewport meta tag"),
      chk("design.no_deprecated", "No obsolete HTML (font/center/marquee)", 15, h.deprecatedTags === 0, h.deprecatedTags ? `${h.deprecatedTags} obsolete presentational tags on homepage` : "None found"),
      chk("design.no_table_layout", "No table-based page layout", 10, h.layoutTables === 0, h.layoutTables ? `${h.layoutTables} layout tables detected` : "None detected"),
      chk("design.webfonts", "Intentional typography (web fonts)", 10, h.usesWebFonts, h.usesWebFonts ? "Web fonts loaded" : "Only system/default fonts detected"),
      chk("design.h1", "Clear primary heading", 10, h.h1.length >= 1, h.h1[0] ? `H1: “${h.h1[0].slice(0, 80)}”` : "No H1 heading on homepage"),
      chk("design.structure", "Sectioned content hierarchy (H2s)", 10, Math.min(1, h.h2.length / 3), `${h.h2.length} H2 headings on homepage`),
      chk("design.cta_visible", "Call-to-action near the top of the page", 15, h.ctaAboveFold, h.ctaAboveFold ? `Early CTA: “${h.ctaTexts[0] ?? ""}”` : "No clear action button found early in the page"),
      chk("design.fresh", "Content appears maintained (copyright year)", 10, h.copyrightYear == null ? 0.6 : !stale, h.copyrightYear ? `© ${h.copyrightYear}` : "No copyright year found"),
      chk("design.brand_assets", "Favicon and share image", 5, (Number(h.favicon) + Number(Boolean(h.og.image))) / 2, `favicon ${h.favicon ? "yes" : "no"}, og:image ${h.og.image ? "yes" : "no"}`),
    ],
    performance: [
      chk("perf.ttfb", "Fast server response", 25, h.ms <= 800 ? 1 : h.ms <= 1800 ? 0.6 : h.ms <= 3500 ? 0.3 : 0, `Homepage HTML delivered in ${h.ms} ms`),
      chk("perf.html_size", "Reasonable HTML size", 15, h.bytes <= 250_000 ? 1 : h.bytes <= 600_000 ? 0.6 : 0.2, `${Math.round(h.bytes / 1024)} KB of HTML`),
      chk("perf.scripts", "Limited JavaScript files", 15, h.scripts.external <= 12 ? 1 : h.scripts.external <= 25 ? 0.5 : 0.1, `${h.scripts.external} external scripts`),
      chk("perf.lazy", "Images lazy-loaded", 15, imgTotal === 0 ? 1 : imgLazy / imgTotal, `${imgLazy}/${imgTotal} images lazy-loaded`),
      chk("perf.modern_images", "Modern image formats (WebP/AVIF)", 15, imgTotal === 0 ? 1 : imgModern / Math.max(1, imgModern + imgLegacy), `${imgModern} modern vs ${imgLegacy} legacy-format images`),
      chk("perf.compression", "Text compression enabled", 15, h.compressed, h.compressed ? "gzip/brotli enabled" : "No content-encoding header on HTML"),
    ],
    mobile: [
      chk("mobile.viewport", "Mobile viewport", 35, viewportOk && !fixedWidth, viewportOk ? "width=device-width" : fixedWidth ? `Fixed-width viewport (${h.viewport})` : "Missing viewport — page renders zoomed-out on phones"),
      chk("mobile.responsive", "Responsive layout signals", 20, h.hasMediaQueries, h.hasMediaQueries ? "Media queries / responsive framework detected" : "No responsive CSS signals detected in page"),
      chk("mobile.tap_to_call", "Tap-to-call phone link", 20, h.telLinks.length > 0, h.telLinks.length ? `tel: ${h.telLinks[0]}` : "Phone number is not tappable"),
      chk("mobile.input_types", "Mobile-friendly form inputs", 10, forms.length === 0 ? 0.5 : forms.some((f) => f.fields.some((x) => ["email", "tel"].includes(x.type))), forms.length ? "Checked input types on forms" : "No forms to evaluate"),
      chk("mobile.no_plugins", "No Flash/plug-ins", 15, !h.flash, h.flash ? "Flash/plug-in content found" : "None"),
    ],
    content: [
      chk("content.depth", "Enough descriptive content", 20, Math.min(1, totalWords / 900), `${totalWords} words across ${all.length} page(s)`),
      chk("content.value_prop", "Clear value proposition in H1", 15, Boolean(h.h1[0] && h.h1[0].split(" ").length >= 3), h.h1[0] ? `“${h.h1[0].slice(0, 80)}”` : "No H1"),
      chk("content.services", "Services described", 15, /services?|what we (do|offer)|menu|treatments|practice areas|programs/.test(blob), "Looked for services/menu/programs content"),
      chk("content.contact", "Contact details visible", 15, h.telLinks.length > 0 || h.mailtoEmails.length > 0 || h.textEmails.length > 0 || /\(\d{3}\)\s?\d{3}|\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(h.text), "Phone/email on homepage"),
      chk("content.about", "About / story content", 10, /about|our story|who we are|meet/.test(blob), "Looked for an About section/page"),
      chk("content.faq", "FAQ content", 10, /faq|frequently asked/.test(blob), "Looked for FAQs"),
      chk("content.location", "Location / service area stated", 10, Boolean(h.addressLike) || (city ? blob.includes(city) : false) || /service area|areas we serve|located/.test(blob), city ? `Searched for “${site.city}”` : "Looked for address/service area"),
      chk("content.hours", "Hours stated", 5, Boolean(all.find((p) => p.hoursLike)) || /hours/.test(blob), "Looked for opening hours"),
    ],
    conversion: [
      chk("conv.cta", "Clear calls-to-action", 20, Math.min(1, h.ctaTexts.length / 2), h.ctaTexts.length ? `CTAs: ${h.ctaTexts.slice(0, 4).map((t) => `“${t}”`).join(", ")}` : "No action-oriented buttons/links found"),
      chk("conv.form", "Lead-capture form", 20, forms.some((f) => f.fields.length >= 2), forms.length ? `${forms.length} form(s): ${forms.map((f) => f.purpose).join(", ")}` : "No contact/quote/booking form on analysed pages"),
      chk("conv.tel", "Phone CTA", 15, h.telLinks.length > 0, h.telLinks.length ? "Tap-to-call present" : "No tap-to-call link"),
      chk("conv.email", "Email contact route", 5, all.some((p) => p.mailtoEmails.length > 0) || forms.length > 0, "Email link or form"),
      chk("conv.primary_path", "Business-specific conversion path", 30, primaryConversion ? primaryConversion.present : features.filter((f) => f.priority === "essential").some((f) => f.present), primaryConversion ? `${primaryConversion.name}: ${primaryConversion.present ? primaryConversion.evidence : "not detected on analysed pages"}` : "Checked essential features"),
      chk("conv.early", "Next step visible without scrolling far", 10, h.ctaAboveFold, h.ctaAboveFold ? "Yes" : "No early CTA"),
    ],
    seo: [
      chk("seo.title", "Descriptive title tag (10–65 chars)", 15, Boolean(h.title && h.title.length >= 10 && h.title.length <= 65) ? 1 : h.title ? 0.5 : 0, h.title ? `“${h.title.slice(0, 90)}” (${h.title.length} chars)` : "Missing <title>"),
      chk("seo.meta_desc", "Meta description (50–170 chars)", 15, Boolean(h.metaDescription && h.metaDescription.length >= 50 && h.metaDescription.length <= 170) ? 1 : h.metaDescription ? 0.5 : 0, h.metaDescription ? `${h.metaDescription.length} chars` : "Missing meta description"),
      chk("seo.single_h1", "Single H1", 10, h.h1.length === 1 ? 1 : h.h1.length > 1 ? 0.5 : 0, `${h.h1.length} H1 tag(s)`),
      chk("seo.local_terms", "Location in title or H1", 15, city ? `${h.title ?? ""} ${h.h1.join(" ")}`.toLowerCase().includes(city) : 0.5, city ? `Checked for “${site.city}”` : "City unknown — partial credit"),
      chk("seo.schema", "LocalBusiness structured data", 15, h.jsonLdTypes.length > 0 ? (h.jsonLdTypes.some((t) => /business|restaurant|store|service|dentist|clinic|organization|place|agent|shop/i.test(t)) ? 1 : 0.5) : 0, h.jsonLdTypes.length ? `JSON-LD: ${h.jsonLdTypes.join(", ")}` : "No JSON-LD structured data"),
      chk("seo.alt", "Image alt text coverage", 10, imgTotal === 0 ? 1 : 1 - imgMissingAlt / imgTotal, `${imgTotal - imgMissingAlt}/${imgTotal} images have alt attributes`),
      chk("seo.indexable", "Indexable (no noindex)", 10, !/noindex/i.test(h.metaRobots ?? ""), h.metaRobots ? `robots: ${h.metaRobots}` : "No robots meta restriction"),
      chk("seo.lang_canonical_og", "lang, canonical & Open Graph", 10, (Number(Boolean(h.lang)) + Number(Boolean(h.canonical)) + Number(Boolean(h.og.title))) / 3, `lang ${h.lang ? "yes" : "no"}, canonical ${h.canonical ? "yes" : "no"}, og:title ${h.og.title ? "yes" : "no"}`),
    ],
    trust: [
      chk("trust.https", "Served over HTTPS", 20, site.https, site.https ? "HTTPS" : "Site is not served over HTTPS — browsers show “Not secure”"),
      chk("trust.mixed", "No insecure (mixed) content", 5, h.mixedContent === 0, h.mixedContent ? `${h.mixedContent} insecure resources` : "None"),
      chk("trust.reviews", "Testimonials or reviews", 20, /testimonial|review|what (our )?(clients|customers|patients) say|★/.test(blob), "Looked for testimonials/reviews"),
      chk("trust.about", "About / team information", 15, /about|our team|meet|our story/.test(blob), "Looked for About/team"),
      chk("trust.address", "Physical address or service area", 10, Boolean(all.find((p) => p.addressLike)) || /service area|areas we serve/.test(blob), all.find((p) => p.addressLike)?.addressLike ?? "No address pattern found"),
      chk("trust.credentials", "Credentials (licensed/insured/certified)", 10, /licen[cs]ed|insured|certified|accredited|bonded|registered/.test(blob), "Looked for credentials"),
      chk("trust.privacy", "Privacy policy", 10, all.some((p) => p.privacyLink), all.some((p) => p.privacyLink) ? "Privacy link present" : "No privacy policy link found"),
      chk("trust.social", "Linked social profiles", 5, Object.keys(h.socialLinks).length > 0, Object.keys(h.socialLinks).join(", ") || "None"),
      chk("trust.fresh", "Recently maintained", 5, h.copyrightYear == null ? 0.5 : !stale, h.copyrightYear ? `© ${h.copyrightYear}` : "Unknown"),
    ],
    functionality: [
      chk("func.essential_features", "Essential features for this business type", 40, essential.length ? essentialPresent / essential.length : 1, `${essentialPresent}/${essential.length} essential features detected: ${essential.map((f) => `${f.name} ${f.present ? "✓" : "✗"}`).join(", ")}`),
      chk("func.links", "No broken internal links", 20, site.linksChecked === 0 ? 1 : 1 - site.brokenLinks.length / site.linksChecked, `${site.brokenLinks.length} broken of ${site.linksChecked} checked`),
      chk("func.nav", "Working navigation", 15, h.hasNav || h.navLinkCount >= 3 ? 1 : h.internalLinks.length >= 3 ? 0.5 : 0, `${h.navLinkCount} nav links`),
      chk("func.forms", "Forms are submittable", 15, forms.length === 0 ? 0 : forms.filter((f) => f.hasSubmit).length / forms.length, forms.length ? `${forms.filter((f) => f.hasSubmit).length}/${forms.length} forms have a submit control` : "No forms"),
      chk("func.renders", "Content renders without heavy client-side JS", 10, h.wordCount >= 80, `${h.wordCount} words in initial HTML`),
    ],
  };

  // Blend in Google PageSpeed (Lighthouse) results where available.
  const scores = {} as Record<ScoreCategory, number>;
  for (const cat of SCORE_CATEGORIES) scores[cat] = scoreCategory(breakdown[cat]);
  if (site.psi?.performance != null) {
    scores.performance = Math.round(site.psi.performance * 0.7 + scores.performance * 0.3);
    breakdown.performance.push({ id: "perf.lighthouse", label: "Google Lighthouse mobile performance", max: 0, earned: 0, passed: site.psi.performance >= 70, evidence: `Lighthouse ${site.psi.performance}/100 (weighted 70%)${site.psi.metrics.lcpMs ? `, LCP ${(site.psi.metrics.lcpMs / 1000).toFixed(1)}s` : ""}` });
  }
  if (site.psi?.seo != null) scores.seo = Math.round(site.psi.seo * 0.3 + scores.seo * 0.7);
  if (site.psi?.accessibility != null) scores.design = Math.round(site.psi.accessibility * 0.2 + scores.design * 0.8);

  const overall = Math.round(SCORE_CATEGORIES.reduce((s, c) => s + scores[c] * CATEGORY_WEIGHTS[c], 0));
  return { scores, breakdown, overall };
}

/** Converts failed/passed checks and feature gaps into human-readable findings. */
export function buildFindings(site: SiteData, breakdown: Record<ScoreCategory, Check[]>, features: FeaturePresence[]): Finding[] {
  const out: Finding[] = [];
  const pagesNote = `${1 + site.pages.length} page${site.pages.length ? "s" : ""} analysed`;
  for (const cat of SCORE_CATEGORIES) {
    for (const c of breakdown[cat]) {
      if (c.max === 0) continue;
      const ratio = c.earned / c.max;
      if (ratio >= 0.999 && c.max >= 15) {
        out.push({ category: cat, severity: "POSITIVE", kind: "VERIFIED", code: c.id, title: c.label, detail: `Meets this check. ${c.evidence}`, evidence: c.evidence });
      } else if (ratio < 0.5) {
        const severity = c.max >= 25 ? "HIGH" : c.max >= 15 ? "MEDIUM" : "LOW";
        out.push({ category: cat, severity, kind: "VERIFIED", code: c.id, title: `${c.label} — not met`, detail: `${c.evidence} (${pagesNote}).`, evidence: c.evidence });
      }
    }
  }
  if (!site.https) out.push({ category: "trust", severity: "CRITICAL", kind: "VERIFIED", code: "trust.no_https", title: "No HTTPS", detail: "Visitors see a “Not secure” warning and form submissions are unencrypted." });
  for (const f of features.filter((x) => !x.present && x.priority !== "optional")) {
    out.push({
      category: "functionality",
      severity: f.priority === "essential" ? "HIGH" : "MEDIUM",
      kind: "INFERRED",
      code: `feature.missing.${f.key}`,
      title: `${f.name} not detected`,
      detail: `Not found on the ${pagesNote}. Potential opportunity: ${f.why}`,
    });
  }
  for (const f of features.filter((x) => x.present)) {
    out.push({ category: "functionality", severity: "POSITIVE", kind: "VERIFIED", code: `feature.present.${f.key}`, title: `${f.name} present`, detail: f.evidence ?? "Detected", evidence: f.evidence ?? undefined });
  }
  if (site.brokenLinks.length) {
    out.push({ category: "functionality", severity: "MEDIUM", kind: "VERIFIED", code: "func.broken_links", title: `${site.brokenLinks.length} broken internal link(s)`, detail: site.brokenLinks.slice(0, 5).map((b) => `${b.url} → ${b.status}`).join("; ") });
  }
  out.push({ category: "design", severity: "LOW", kind: "UNKNOWN", code: "design.visual_review", title: "Visual design quality needs a human look", detail: "Design scores are based on structural signals (layout tech, typography, hierarchy, CTAs). Colour, imagery and brand polish should be confirmed visually." });
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, POSITIVE: 4 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
