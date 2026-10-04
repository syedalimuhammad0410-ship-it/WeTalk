import { FEATURES } from "../intel/features";
import type { FormSpec, PageSpec } from "../intel/playbooks";
import type { PromptContext } from "./context";
import { SCORE_CATEGORIES, SCORE_CATEGORY_LABEL, WEBSITE_CLASS_META } from "../../constants";

/**
 * Deterministic composer for the WEBSITE DEVELOPMENT MASTER PROMPT.
 * Every factual statement comes from ctx.facts (with its source) or the audit;
 * everything else is phrased as a recommendation/inference or a labelled placeholder.
 */

export const REQUIRED_SECTIONS = [
  "0. HOW TO USE THIS SPECIFICATION",
  "1. BUSINESS INFORMATION",
  "2. BUSINESS SUMMARY",
  "3. TARGET AUDIENCE",
  "4. WEBSITE OBJECTIVES",
  "5. CURRENT WEBSITE AUDIT",
  "6. RECOMMENDED INFORMATION ARCHITECTURE",
  "7. PAGE-BY-PAGE SPECIFICATION",
  "8. HOMEPAGE SPECIFICATION",
  "9. DESIGN SYSTEM",
  "10. FUNCTIONALITY",
  "11. FORMS",
  "12. RESPONSIVE BEHAVIOUR",
  "13. ACCESSIBILITY",
  "14. SEO",
  "15. PERFORMANCE",
  "16. SECURITY",
  "17. ANALYTICS",
  "18. CONTENT RULES",
  "19. INFORMATION THE BUSINESS MUST PROVIDE",
  "20. EDGE CASES",
  "21. FINAL ACCEPTANCE CRITERIA",
  "22. BUILD ORDER",
] as const;

const H = (s: string) => `\n${"=".repeat(64)}\n${s}\n${"=".repeat(64)}\n`;
const sub = (s: string) => `\n--- ${s} ---\n`;
const bullets = (items: (string | null | undefined | false)[], indent = "") => items.filter(Boolean).map((i) => `${indent}- ${i}`).join("\n");

function cityize(s: string, ctx: PromptContext) {
  return s
    .replace(/\{city\}/g, ctx.city ?? "[CITY]")
    .replace(/\{category\}/g, (ctx.business.category ?? ctx.playbook.label).toLowerCase())
    .replace(/\{cuisine\}/g, ctx.business.category?.toLowerCase().replace(/restaurant/i, "").trim() || "[CUISINE]")
    .replace(/\{(subject|service|trip type|type|landmark)\}/g, (_, k) => `[${String(k).toUpperCase()}]`);
}

function titleFor(page: PageSpec, ctx: PromptContext) {
  const name = ctx.business.name;
  const where = ctx.city ? ` in ${ctx.city}` : "";
  if (page.slug === "/") return `${name} | ${ctx.business.category ?? ctx.playbook.label}${where}`.slice(0, 70);
  return `${page.name}${where} | ${name}`.slice(0, 70);
}

function verifiedServicesLine(ctx: PromptContext) {
  if (ctx.servicesVerified.length) return ctx.servicesVerified.map((s) => `${s.name} (website says: “${s.evidence}”)`);
  return [];
}

export function composeMasterPrompt(ctx: PromptContext): string {
  const b = ctx.business;
  const pb = ctx.playbook;
  const detailed = ctx.options.detail === "detailed";
  const concise = ctx.options.detail === "concise";
  const where = ctx.location ?? "[LOCATION TO CONFIRM]";
  const hasSite = Boolean(ctx.audit && ctx.audit.websiteStatus === "WEBSITE_FOUND");
  const findings = ctx.audit?.findings ?? [];
  const negatives = findings.filter((f) => f.severity !== "POSITIVE");
  const positives = findings.filter((f) => f.severity === "POSITIVE");
  const features = ctx.features.filter((f) => FEATURES[f.key]);
  const missing = features.filter((f) => f.status === "missing");
  const present = features.filter((f) => f.status === "present");
  const servicesV = verifiedServicesLine(ctx);
  const pages = buildPages(ctx);
  const out: string[] = [];

  out.push(`WEBSITE DEVELOPMENT MASTER PROMPT
${b.name} — ${pb.label}${ctx.location ? `, ${ctx.location}` : ""}
Prepared ${ctx.generatedAt.toISOString().slice(0, 10)} by WebScout AI from publicly available information and an automated website audit.
Opportunity score: ${ctx.opportunityScore}/100 (a prioritisation estimate, not a revenue prediction).`);

  // 0
  out.push(H(REQUIRED_SECTIONS[0]));
  out.push(`You are an expert web designer, UX strategist, conversion specialist, accessibility engineer, SEO specialist and senior front-end developer. Build a complete, production-quality website for ${b.name}, a ${pb.label.toLowerCase()} ${ctx.location ? `in ${ctx.location}` : ""}. This document is the full specification. Follow it section by section.

NON-NEGOTIABLE FACTUALITY RULES
${bullets([
  "Use verified information only. Section 1 lists every verified fact and its source. Anything not listed there is UNKNOWN.",
  "If information is missing, create a clearly labelled placeholder in square brackets, e.g. [BUSINESS OWNER TO PROVIDE], [VERIFY HOURS], [ADD REAL TESTIMONIAL], [BUSINESS TO PROVIDE PRICING], [ADD REAL PHOTO: description].",
  "Never invent: business hours, prices, discounts, certifications, licences, awards, testimonials, reviews, ratings, employees, team names, addresses, service areas, services, years in business, customer counts, guarantees, or statistics.",
  "Never write fake testimonials or fake customer reviews — not even as “sample” content. Use [ADD REAL TESTIMONIAL] blocks instead.",
  "Never present stock imagery as the business's own work, staff or premises.",
  "Recommendations in this document (pages, features, copy direction) are suggestions for the business to approve — implement them, but do not state them as facts about the business in visible copy.",
  "Keep all placeholders easy to find: render them visibly in the UI during review AND list them in a PLACEHOLDERS.md file at the project root.",
])}

LABELS USED IN THIS DOCUMENT
${bullets(["VERIFIED — taken from a named source (listing or the business's own website).", "INFERRED — a reasoned assumption about the business type; must not appear as a fact in site copy.", "RECOMMENDATION — what we suggest building.", "UNKNOWN — must be supplied by the business before launch."])}

If your environment already has a framework (e.g. Lovable, Replit templates), use it. Otherwise use a modern, static-first stack (e.g. Next.js or Astro + TypeScript + Tailwind CSS) that produces fast, accessible, SEO-friendly HTML. All business data (services, hours, contact details, menu/prices, testimonials) must live in a single structured content file or CMS collection so it can be updated without touching layout code.`);

  // 1
  out.push(H(REQUIRED_SECTIONS[1]));
  out.push(`Business name: ${b.name}
Business category: ${b.category ?? `[CONFIRM CATEGORY] (classified as ${pb.label}, ${b.businessTypeConfidence ?? "?"}% confidence — INFERRED)`}
Location: ${where}
Phone: ${b.phone ?? "[BUSINESS OWNER TO PROVIDE PHONE]"}
Email: ${b.email ?? "[BUSINESS OWNER TO PROVIDE EMAIL]"}
Website: ${b.website ?? "None found"}

VERIFIED INFORMATION
${ctx.facts.map((f) => `- ${f.label}: ${f.value}  (source: ${f.source})`).join("\n")}
${servicesV.length ? `- Services explicitly stated on the current website:\n${bullets(servicesV, "  ")}` : ""}
${ctx.differentiators.length ? `- Claims the business makes about itself on its website (may be reused, attributed as their own claims):\n${bullets(ctx.differentiators.map((d) => `${d.claim} (“${d.evidence}”)`), "  ")}` : ""}

UNKNOWN INFORMATION (must be supplied — use placeholders until then)
${bullets(ctx.unknowns)}`);

  // 2
  out.push(H(REQUIRED_SECTIONS[2]));
  const summaryParts = [
    `VERIFIED: ${b.name} is listed as ${b.category ? `a “${b.category}”` : "a local business"}${ctx.location ? ` in ${ctx.location}` : ""}${b.address ? ` (${b.address})` : ""}.`,
    ctx.extracted?.ai?.summary ? `VERIFIED (summarised from the business's own website): ${ctx.extracted.ai.summary}` : null,
    b.rating != null && b.reviewCount ? `VERIFIED: The public listing shows a ${b.rating.toFixed(1)} rating from ${b.reviewCount} reviews — evidence of an active customer base. Do not reproduce rating numbers on the site without approval.` : null,
    hasSite ? `VERIFIED: The business has a website (${ctx.audit?.finalUrl}) that scored ${ctx.audit?.overallScore}/100 in our audit and was classified as “${WEBSITE_CLASS_META[ctx.audit?.classification ?? "BASIC"]?.label}”.` : b.website ? `VERIFIED: A website is listed (${b.website}) but it could not be fully analysed (${ctx.audit?.classification ? WEBSITE_CLASS_META[ctx.audit.classification]?.label : "not audited"}).` : "VERIFIED: No website was found for this business in the available sources.",
    `INFERRED: As a ${pb.label.toLowerCase()}, the business most likely wins customers through ${pb.primaryConversion.toLowerCase()} and ${pb.secondaryConversions.slice(0, 2).join(" / ").toLowerCase()}.`,
    "UNKNOWN: Founding year, ownership, team, exact service list, pricing, and unique selling points — the site copy must not assert any of these until provided.",
  ];
  out.push(summaryParts.filter(Boolean).join("\n"));

  // 3
  out.push(H(REQUIRED_SECTIONS[3]));
  out.push(`IMPORTANT: The following are likely customer segments for a ${pb.label.toLowerCase()}${ctx.city ? ` in ${ctx.city}` : ""}. They are INFERRED from the business type, not facts about this business's customers. Do not state demographics as facts in copy.
${bullets(pb.audience.map((a) => a.replace(/\(likely primary.*?\)/, "(likely primary — INFERRED)")))}

Questions these visitors arrive with (design every page to answer them quickly):
${bullets(pb.visitorQuestions)}`);

  // 4
  out.push(H(REQUIRED_SECTIONS[4]));
  out.push(`Primary objective: ${pb.primaryGoal}
Primary conversion: ${pb.primaryConversion}
Secondary conversions: ${pb.secondaryConversions.join(", ")}

The website should:
${bullets([
  `Make ${pb.primaryConversion.toLowerCase()} possible from every page in at most two taps on mobile.`,
  `Communicate within 5 seconds what ${b.name} offers${ctx.city ? `, that it serves ${ctx.city}` : ""}, and how to take the next step.`,
  "Build trust using only real, verifiable proof (reviews, photos, credentials supplied by the business).",
  "Rank for local searches relevant to the business (see SEO section) with fast, accessible, well-structured pages.",
  hasSite ? "Fix the specific weaknesses found in the current website (section 5) while keeping any content that already works." : "Establish a professional web presence the business owns and controls (rather than relying only on third-party listings).",
  "Be easy for the business to update (hours, services, prices, photos) without a developer.",
])}

Success measures to instrument: ${pb.events.slice(0, 6).join(", ")} (see Analytics).`);

  // 5
  out.push(H(REQUIRED_SECTIONS[5]));
  if (!ctx.audit) {
    out.push("No automated audit has been run. Treat the current online presence as UNKNOWN and build from the recommendations below.");
  } else if (!hasSite) {
    out.push(`${ctx.audit.summary ?? ""}
${bullets(negatives.map((f) => `[${f.kind}] ${f.title}: ${f.detail}`))}

What currently exists: ${b.website ? `only ${b.website}` : "no website"}. Everything in this specification is therefore new.

Opportunity reasons (from WebScout analysis):
${bullets(ctx.opportunityReasons.filter((r) => r.points > 0).map((r) => `[${r.kind}] ${r.label}`))}`);
  } else {
    const scores = (ctx.audit.scores ?? {}) as Record<string, number>;
    const ex = ctx.extracted;
    out.push(`Audited URL: ${ctx.audit.finalUrl}
Classification: ${WEBSITE_CLASS_META[ctx.audit.classification ?? "BASIC"]?.label} — ${WEBSITE_CLASS_META[ctx.audit.classification ?? "BASIC"]?.description}
Overall score: ${ctx.audit.overallScore}/100
${SCORE_CATEGORIES.map((c) => `  ${SCORE_CATEGORY_LABEL[c].padEnd(14)} ${String(scores[c] ?? "—").padStart(3)}/100`).join("\n")}
Pages analysed: ${(ex?.pagesAnalysed ?? []).map((p) => p.url).join(", ")}
${ex?.platform ? `Current platform (detected): ${ex.platform}` : ""}`);
    out.push(sub("What currently exists"));
    out.push(bullets([
      ex?.title ? `Title tag: “${ex.title}”` : "No title tag",
      ex?.h1?.length ? `Main heading(s): ${ex.h1.map((h) => `“${h}”`).join(", ")}` : "No H1 heading",
      ex?.headings?.length ? `Section headings found: ${ex.headings.slice(0, concise ? 8 : 20).map((h) => `“${h}”`).join(", ")}` : null,
      ex?.ctas?.length ? `Calls-to-action found: ${ex.ctas.map((c) => `“${c}”`).join(", ")}` : "No clear calls-to-action found",
      ex?.forms?.length ? `Forms: ${ex.forms.map((f) => `${f.purpose} form (${f.fields.join(", ") || "fields unlabeled"})`).join("; ")}` : "No lead-capture forms found",
      ex?.singlePage ? "Structure: most content is on a single scrolling page." : null,
      ex?.outdatedSignals?.length ? `Outdated signals: ${ex.outdatedSignals.join(", ")}` : null,
    ]));
    out.push(sub("What works (keep or improve)"));
    out.push(positives.length ? bullets(positives.slice(0, concise ? 5 : 15).map((f) => `${f.title}${f.evidence ? ` — ${f.evidence}` : ""}`)) : "- Nothing notable — treat as a rebuild.");
    for (const [label, cats] of [
      ["What doesn't work", ["functionality", "trust", "performance"]],
      ["Mobile issues", ["mobile"]],
      ["Design issues", ["design"]],
      ["Content issues", ["content"]],
      ["Conversion issues", ["conversion"]],
      ["SEO opportunities", ["seo"]],
    ] as const) {
      const items = negatives.filter((f) => (cats as readonly string[]).includes(f.category) && !f.code.startsWith("feature.missing"));
      out.push(sub(label));
      out.push(items.length ? bullets(items.map((f) => `[${f.kind}${f.severity === "CRITICAL" || f.severity === "HIGH" ? `, ${f.severity}` : ""}] ${f.title}: ${f.detail}`)) : "- No significant issues detected in this area.");
    }
    out.push(sub("Missing functionality (not detected on analysed pages)"));
    out.push(missing.length ? bullets(missing.map((f) => `${f.name} (${f.priority}) — ${f.why}`)) : "- All essential features for this business type were detected.");
    if (present.length) {
      out.push(sub("Existing functionality to preserve/migrate"));
      out.push(bullets(present.map((f) => `${f.name} — keep, but restyle and integrate into the new design (verify the provider/link with the business).`)));
    }
    if (ctx.audit.performance) {
      const p = ctx.audit.performance as { performance?: number; metrics?: { lcpMs?: number; cls?: number } };
      out.push(sub("Measured performance (Google Lighthouse, mobile)"));
      out.push(bullets([`Performance score: ${p.performance ?? "n/a"}/100`, p.metrics?.lcpMs ? `Largest Contentful Paint: ${(p.metrics.lcpMs / 1000).toFixed(1)}s (target < 2.5s)` : null, p.metrics?.cls != null ? `Cumulative Layout Shift: ${p.metrics.cls.toFixed(2)} (target < 0.1)` : null]));
    }
    out.push("\nContent migration: reuse factual content from the current site (service descriptions, contact details, any real photos and testimonials) only after confirming it is still accurate. Do not copy outdated claims.");
  }

  // 6
  out.push(H(REQUIRED_SECTIONS[6]));
  out.push(`Recommended sitemap (adapted to a ${pb.label.toLowerCase()} — RECOMMENDATION; remove pages for services the business does not offer):\n`);
  out.push(pages.map((p) => `${p.slug === "/" ? "/" : `  ${p.slug}`}  — ${p.name}: ${p.purpose}`).join("\n"));
  out.push(`\nPrimary navigation (max 6 items, top-level pages only; service detail pages live under a Services dropdown/mega-menu): ${pages.filter((p) => p.slug !== "/" && p.slug.split("/").length === 2 && !/privacy|terms|quote/.test(p.slug)).slice(0, 6).map((p) => p.name).join(" · ")}
Header utility: phone link${b.phone ? ` (${b.phone})` : " [PHONE]"} + primary CTA button “${pages[0]?.cta ?? "Contact us"}”.
Footer navigation: all pages + Privacy Policy + Accessibility statement + (if applicable) Terms.
Utility pages: /privacy, /accessibility, custom 404 with links back to key pages and a contact CTA.`);

  // 7
  out.push(H(REQUIRED_SECTIONS[7]));
  for (const p of pages.filter((x) => x.slug !== "/")) {
    out.push(sub(`${p.name} (${p.slug})`));
    out.push(bullets([
      `Purpose: ${p.purpose}`,
      `Target visitor: ${pageVisitor(p, ctx)}`,
      `Sections: ${p.sections.length ? p.sections.join(" → ") : "Hero → Content → CTA"}`,
      `Content: ${pageContent(p, ctx)}`,
      `Primary CTA: “${p.cta}”${p.slug.includes("quote") || p.slug.includes("contact") ? "" : " (plus phone link)"}`,
      `Functionality: ${pageFunctionality(p, ctx)}`,
      `Mobile behaviour: single column; CTA repeated after the main content; sticky bottom action bar remains visible${p.slug.includes("menu") ? "; category nav becomes a horizontally scrollable sticky chip row" : ""}.`,
      `SEO: <title>${titleFor(p, ctx)}</title>; unique meta description (140–160 chars) summarising the page for ${ctx.city ?? "local"} searchers; one H1; descriptive H2s.`,
      `Trust signals: ${pageTrust(p, ctx)}`,
    ]));
  }

  // 8
  out.push(H(REQUIRED_SECTIONS[8]));
  out.push(`Adapted for a ${pb.label.toLowerCase()} — do not add generic sections that don't serve this business. Order:\n`);
  out.push(pb.homepage.map((s, i) => `${i + 1}. ${cityize(s, ctx).replace(/\[PHONE\]/g, b.phone ?? "[PHONE]")}`).join("\n"));
  out.push(`\nHero copy direction (RECOMMENDATION — final copy must be approved by the business):
${bullets([
  `H1 pattern: “${heroH1(ctx)}” — keep under ~60 characters; must be true for this business.`,
  `Supporting line: one sentence describing what the business does using only verified services${servicesV.length ? "" : " (or [BUSINESS TO CONFIRM SERVICES])"}.`,
  `Primary CTA: “${pages[0]?.cta ?? pb.primaryConversion}”; secondary CTA: ${b.phone ? `“Call ${b.phone}”` : "phone link [PHONE]"}.`,
  "Hero image: a real photo supplied by the business ([ADD REAL PHOTO: storefront / team at work / signature product]) — preload it, serve AVIF/WebP, and include descriptive alt text.",
])}`);

  // 9
  out.push(H(REQUIRED_SECTIONS[9]));
  out.push(`Brand identity status: ${ctx.extracted?.platform || hasSite ? "an existing website exists — extract logo and colours from it and confirm with the owner" : "no brand assets verified"}. Do not force exact colours; expose them as configurable design tokens.

Personality: ${pb.design.personality}
Typography: ${pb.design.typography}
  - Type scale (fluid, clamp-based): H1 2.25–3.5rem, H2 1.75–2.25rem, H3 1.25–1.5rem, body 1–1.125rem, small 0.875rem; line-height 1.1–1.2 headings, 1.6 body; max line length ~70ch.
Spacing: 4px base unit; section padding 64–96px desktop / 48–64px mobile; consistent vertical rhythm.
Layout: ${pb.design.layout}
Colour: ${pb.design.color}
  - Tokens: --color-primary [CONFIGURABLE], --color-accent [CONFIGURABLE — reserved for primary CTAs], --color-bg, --color-surface, --color-text, --color-muted, --color-border, --color-success, --color-error. All text/background pairs ≥ 4.5:1 (3:1 for large text and UI components).
Buttons: primary (solid accent), secondary (outline), tertiary (text link); min height 44px (48px on touch); clear hover, active, focus-visible and disabled states; loading state with spinner and aria-busy.
Cards: subtle border or soft shadow, 12–16px radius (token --radius), consistent internal padding, whole-card link areas where appropriate.
Forms: labels above inputs, 16px+ input text (prevents iOS zoom), clear error text below fields, success panels.
Navigation: sticky header that compacts on scroll; mobile menu as an accessible full-height drawer with focus trap and Esc to close.
Icons: one consistent outline icon set (e.g. Lucide) used sparingly; icons always paired with text labels.
Imagery: ${pb.design.imagery}
Border radius: token-based (--radius-sm 8px, --radius 12px, --radius-lg 20px) — adjust to brand.
Visual hierarchy: one dominant CTA per viewport; scannable headings; generous whitespace; avoid walls of text.
Animation: ${pb.design.motion}
Dark mode: optional; only if it suits the brand. Must keep contrast ratios.`);

  // 10
  out.push(H(REQUIRED_SECTIONS[10]));
  out.push(`Features selected for THIS business (from the ${pb.label.toLowerCase()} playbook and the audit). Status reflects the current website.\n`);
  for (const f of features) {
    const def = FEATURES[f.key]!;
    out.push(sub(`${def.name} — ${f.priority.toUpperCase()} (${f.status === "missing" ? "currently missing" : f.status === "present" ? "exists today — rebuild/integrate" : "status unknown"})`));
    out.push(`Why (INFERRED/RECOMMENDATION): ${f.why}`);
    out.push(bullets(def.spec));
    if (def.ownerInputs?.length && !concise) out.push(`Needs from the business: ${def.ownerInputs.join("; ")}.`);
  }
  if (ctx.options.removeFeatures.length) out.push(`\nExplicitly excluded by request: ${ctx.options.removeFeatures.map((k) => FEATURES[k]?.name ?? k).join(", ")}. Do not build these.`);

  // 11
  out.push(H(REQUIRED_SECTIONS[11]));
  for (const form of formsFor(ctx)) {
    out.push(sub(form.name));
    out.push(`Purpose: ${form.purpose}`);
    out.push(`Fields:\n${form.fields.map((f) => `  - ${f.label} — ${f.type}${f.required ? " — required" : " — optional"}${f.note ? ` (${f.note})` : ""}`).join("\n")}`);
  }
  out.push(`\nFor EVERY form:
${bullets([
  "Validation: client-side (HTML constraints + inline messages on blur/submit) AND server-side with the same rules; trim input; enforce max lengths; validate email/phone formats.",
  "Error states: message next to each invalid field (aria-describedby), summary at top on submit with links to fields, never clear user input on error, server/network error banner with phone fallback.",
  "Loading state: disable submit, show spinner + “Sending…”, set aria-busy, prevent double submit.",
  "Success state: replace form with a confirmation panel (focus moved to it) explaining what happens next — response time [BUSINESS TO CONFIRM]. Fire the analytics event.",
  "Spam protection: honeypot field, minimum time-to-submit, per-IP rate limiting on the endpoint; add Cloudflare Turnstile/hCaptcha only if spam is a real problem.",
  "Accessibility: visible <label> for every field, required fields marked with text not just colour, autocomplete attributes (name, email, tel, postal-code), logical tab order, 44px targets.",
  "Delivery: send to the business inbox via a transactional email service using server-side environment variables; store nothing sensitive; include a privacy notice link.",
  "Consent: no pre-ticked marketing checkboxes; marketing consent separate from enquiry submission.",
])}`);

  // 12
  out.push(H(REQUIRED_SECTIONS[12]));
  out.push(bullets([
    `Phone (< 640px): single column; header shows logo + menu button + ${pb.primaryConversion.toLowerCase().includes("call") ? "call" : "primary CTA"} icon; sticky bottom action bar with ${b.phone ? "Call" : "Call [PHONE]"} and “${pages[0]?.cta ?? "Contact"}” (hidden when the on-screen keyboard is open and when the footer is visible); tap targets ≥ 48px; images full-width with aspect-ratio boxes; tables become stacked cards.`,
    "Tablet (640–1023px): two-column grids for cards; navigation collapses to the drawer below 1024px; hero text left-aligned over image or stacked.",
    "Desktop (1024–1439px): full navigation visible; 12-column grid; hero split (copy + image); 3–4 column card grids; sticky compact header.",
    "Large desktop (≥ 1440px): content max-width ~1280px centred; scale typography with clamp(); never stretch line length beyond ~75ch; use extra space for imagery, not wider text.",
    "Test on real devices or emulation at 360, 390, 768, 1024, 1280 and 1536px widths; no horizontal scrolling at any width; supports 200% zoom.",
    "Landscape phones: sticky bar must not cover more than 15% of the viewport.",
  ]));

  // 13
  out.push(H(REQUIRED_SECTIONS[13]));
  out.push(`Target WCAG 2.2 AA.\n${bullets([
    "Semantic HTML: header, nav, main, section with headings, footer; one H1 per page; heading levels never skip.",
    "Keyboard navigation for everything (menu, accordions, lightbox, sliders, forms); visible :focus-visible styles (≥ 3:1 contrast, 2px outline offset); skip-to-content link.",
    "ARIA only where native HTML can't express the pattern (e.g. aria-expanded on disclosure buttons, aria-current on active nav item, aria-live for form status).",
    "Colour contrast ≥ 4.5:1 for text, 3:1 for large text and UI; never convey meaning by colour alone.",
    "Every form input has a programmatic label; errors announced via aria-live; required fields indicated in text.",
    "Meaningful alt text for informative images (describe content, not “image of”); empty alt for decorative images.",
    "Respect prefers-reduced-motion: disable non-essential animation and auto-advancing content.",
    "Embedded third-party widgets (booking, maps, ordering) must have accessible text alternatives/links.",
    "Publish an /accessibility page with a contact method for accessibility issues [BUSINESS TO APPROVE WORDING].",
  ])}`);

  // 14
  out.push(H(REQUIRED_SECTIONS[14]));
  out.push(`Title tags (≤ 60 chars, unique):\n${pages.map((p) => `  ${p.slug.padEnd(28)} ${titleFor(p, ctx)}`).join("\n")}

${bullets([
  `Meta descriptions: unique per page, 140–160 characters, naming ${b.name}, the specific service/page topic${ctx.city ? ` and ${ctx.city}` : ""}, written from verified information.`,
  "Headings: one descriptive H1 per page containing the main topic; H2s for sections; avoid keyword stuffing.",
  "Canonical URLs on every page (self-referencing, https, no trailing-slash duplicates); redirect http→https and www/non-www to one version.",
  hasSite ? `Preserve rankings: map every existing URL from the current site (${(ctx.extracted?.pagesAnalysed ?? []).map((p) => new URL(p.url).pathname).join(", ") || "audit pages"}) to its new equivalent with 301 redirects.` : null,
  "Open Graph and Twitter Card tags per page (og:title, og:description, og:image 1200×630 using a real photo, og:url, og:type).",
  `Structured data (JSON-LD) on the homepage using schema.org/${pb.schemaType}, including ONLY verified fields: name “${b.name}”${b.address ? `, address “${b.address}”` : ", address [VERIFY]"}${b.phone ? `, telephone “${b.phone}”` : ""}, url, ${b.hours.length ? "openingHoursSpecification from verified hours" : "openingHours [VERIFY HOURS — omit until confirmed]"}, sameAs (verified social profiles), geo (if address verified). Do NOT add aggregateRating or review markup unless the business supplies first-party reviews that comply with search-engine guidelines.`,
  "Add FAQPage markup only for FAQs whose answers are approved by the business; BreadcrumbList on inner pages.",
  `Local SEO: consistent NAP (name, address, phone) everywhere, matching the Google Business Profile exactly; embed location/service-area content naturally; link to the Google Business Profile${b.googleMapsUrl ? ` (${b.googleMapsUrl})` : ""}.`,
  `Target search themes (validate with keyword research; do not stuff): ${pb.seoKeywords.map((k) => `“${cityize(k, ctx)}”`).join(", ")}.`,
  "XML sitemap (auto-generated, submitted to Google Search Console) and robots.txt allowing crawling of public pages and referencing the sitemap.",
  "Internal linking: homepage → every service/key page; related services cross-link; every page links to the primary conversion page with descriptive anchor text.",
  "Image SEO: descriptive file names and alt text; dimensions set; compressed.",
])}`);

  // 15
  out.push(H(REQUIRED_SECTIONS[15]));
  out.push(`Budgets (mobile, 4G): LCP < 2.5s, CLS < 0.1, INP < 200ms, total JS < 150KB gzipped on content pages, Lighthouse performance ≥ 90.${ctx.audit?.performance ? ` (Current site measured ${(ctx.audit.performance as { performance?: number }).performance ?? "n/a"}/100.)` : ""}\n${bullets([
  "Images: AVIF/WebP with responsive srcset/sizes, explicit width/height, lazy-load everything below the fold, preload only the hero image (fetchpriority=high).",
  "Fonts: self-host or use font-display: swap; subset; preload at most 2 font files; prefer variable fonts.",
  "Code splitting: ship only the JS each page needs; render content as static HTML (SSG/ISR); hydrate interactive islands only.",
  "Third-party widgets (booking, ordering, maps, chat, reviews): load on interaction or when scrolled into view; never block first render.",
  "Caching: immutable hashed assets with long Cache-Control; HTML with short TTL/revalidation; CDN delivery; Brotli compression.",
  "Avoid carousels/sliders in the hero, autoplay video, large icon fonts, and unused CSS.",
])}`);

  // 16
  out.push(H(REQUIRED_SECTIONS[16]));
  out.push(bullets([
    "HTTPS everywhere with HSTS; no mixed content.",
    "Validate and sanitise all input server-side; escape all output; never render user input as HTML.",
    "Secrets (email service keys, booking API keys, analytics IDs that are private) live in environment variables on the server only — never in client bundles or the repository.",
    "Form endpoints: rate limiting, honeypot, size limits, CSRF protection where cookies are used, and generic error messages (no stack traces).",
    "File uploads (if any): type/size whitelist, virus scan or trusted storage provider, randomised names, never served from the same origin as executable code.",
    "Security headers: Content-Security-Policy (allow-list the third-party widgets in use), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors.",
    "Dependencies pinned and audited; no unused packages.",
    "Privacy: cookie/analytics consent banner where legally required; privacy policy describing what forms collect [BUSINESS/LEGAL TO APPROVE].",
  ]));

  // 17
  out.push(H(REQUIRED_SECTIONS[17]));
  out.push(`Use privacy-respecting analytics (e.g. GA4 with consent mode, Plausible, or similar — [BUSINESS TO CHOOSE]). Track these events:\n`);
  const events = Array.from(new Set([...pb.events, "cta_click", "phone_click", "email_click", ...features.flatMap((f) => FEATURES[f.key]?.events ?? [])]));
  out.push(events.map((e) => `  - ${e}: ${eventDescription(e)}`).join("\n"));
  out.push("\nEvery event includes page path and, where relevant, cta_location. Mark the primary conversion events as conversions. Do not send personal data (names, emails, phone numbers) to analytics.");

  // 18
  out.push(H(REQUIRED_SECTIONS[18]));
  out.push(`Never invent:\n${bullets(["business hours", "prices or discounts", "certifications, licences, awards", "testimonials or reviews", "employees or team names", "addresses or service areas", "services or menu items", "statistics, years in business, customer counts", "guarantees, warranties, response times"])}

Use these exact placeholder formats when information is unavailable:
${bullets(["[BUSINESS OWNER TO PROVIDE]", "[VERIFY HOURS]", "[ADD REAL TESTIMONIAL]", "[BUSINESS TO PROVIDE PRICING]", "[ADD REAL PHOTO: description]", "[CONFIRM SERVICE OFFERED]", "[VERIFY LICENCE NUMBER]", "[BRAND COLOURS TO CONFIRM]"])}

Copy style: clear, specific, benefit-led, plain language (reading age ~12–14), active voice, no hype (“best”, “#1”, “world-class”) unless the business can substantiate it. Industry compliance notes:
${bullets(pb.compliance)}`);

  // 19
  out.push(H(REQUIRED_SECTIONS[19]));
  const owner = Array.from(new Set([...pb.ownerInputs, ...features.flatMap((f) => FEATURES[f.key]?.ownerInputs ?? []), ...ctx.unknowns]));
  out.push(`Create a PLACEHOLDERS.md checklist containing at least:\n${bullets(owner)}`);
  if (pb.faqTopics.length) out.push(`\nFAQ topics to draft questions for (answers must come from the business):\n${bullets(pb.faqTopics)}`);

  // 20
  out.push(H(REQUIRED_SECTIONS[20]));
  out.push(bullets([
    "Missing images: render tasteful neutral placeholders with the [ADD REAL PHOTO] label — never broken image icons, never stock photos posing as real.",
    `Long names/content: “${b.name}” and long service names must wrap gracefully at 320px without overflow.`,
    "No testimonials yet: hide the testimonials section entirely in production rather than showing placeholders; keep it in staging for review.",
    "Unverified hours: show “Call to confirm hours” instead of guessing; holiday hours banner configurable.",
    "Form submission failure / offline: keep the user's input, show a retry button and the phone/email fallback.",
    "Third-party widget fails to load (booking/ordering/maps): show a plain link and phone fallback.",
    "JavaScript disabled: all content readable; navigation and contact links work; forms degrade to standard POST where possible.",
    "Slow 3G: hero text visible before images; no layout shift when images load.",
    "Very small (320px) and very large (2560px) screens: layout remains intact.",
    "Do Not Track / declined consent: analytics disabled without breaking the page.",
    "404 and 500 pages styled and helpful.",
  ]));

  // 21
  out.push(H(REQUIRED_SECTIONS[21]));
  const accept = [
    `All pages in the sitemap exist, are linked from navigation, and render correctly at 360px, 768px, 1280px and 1536px.`,
    `${pb.primaryConversion} works end-to-end (including validation, loading, success and error states) and is reachable within two taps from every page on mobile.`,
    ...features.filter((f) => f.priority === "essential").map((f) => `${FEATURES[f.key]!.name} implemented as specified.`),
    "No invented facts: every hour, price, service, testimonial, credential and team detail is either verified (traceable to section 1) or a visible placeholder listed in PLACEHOLDERS.md.",
    "Phone number is a tap-to-call link everywhere it appears; email is a mailto link.",
    "Lighthouse (mobile) ≥ 90 Performance, ≥ 95 Accessibility, ≥ 95 Best Practices, ≥ 95 SEO on Home and the primary conversion page.",
    "Zero axe-core critical/serious accessibility violations; full keyboard operability verified manually.",
    "Every page has a unique title, meta description, canonical, Open Graph tags and exactly one H1.",
    `Valid JSON-LD (${pb.schemaType}) with verified fields only — passes Google's Rich Results Test.`,
    "XML sitemap and robots.txt present; 301 redirects in place for any old URLs.",
    "All analytics events from section 17 fire once per action with correct parameters (verified in debug view).",
    "Forms deliver to the configured inbox; spam protections active; secrets not present in client bundles.",
    "Security headers present; HTTPS enforced; no mixed content.",
    "Content is editable from a single structured content source (no hard-coded business data scattered in components).",
    "prefers-reduced-motion respected; no horizontal scroll at any breakpoint; 200% zoom usable.",
    "PLACEHOLDERS.md lists every outstanding item for the business owner.",
  ];
  out.push(accept.map((a) => `[ ] ${a}`).join("\n"));

  // 22
  out.push(H(REQUIRED_SECTIONS[22]));
  out.push(bullets([
    "1. Set up project, design tokens, typography and base layout (header, footer, sticky mobile bar).",
    "2. Create the structured content file with verified facts and placeholders (section 1 + 19).",
    "3. Build the homepage exactly as specified in section 8.",
    `4. Build the primary conversion flow (${pb.primaryConversion}) with all form states.`,
    "5. Build remaining pages from section 7.",
    "6. Add SEO (metadata, JSON-LD, sitemap, robots, redirects), analytics events, and security headers.",
    "7. Run accessibility, performance and responsive checks; fix issues.",
    "8. Walk through the acceptance criteria and produce PLACEHOLDERS.md.",
  ]));

  if (ctx.options.extraInstructions.trim()) {
    out.push(H("ADDITIONAL INSTRUCTIONS FROM THE AGENCY"));
    out.push(ctx.options.extraInstructions.trim());
  }

  if (detailed) {
    out.push(H("APPENDIX — CONVERSION STRATEGY NOTES"));
    out.push(bullets([
      `Primary path: landing → value proposition → proof → ${pb.primaryConversion.toLowerCase()}. Remove every step that does not help a visitor decide.`,
      `Secondary paths for visitors not ready to commit: ${pb.secondaryConversions.join(", ")}.`,
      "Repeat the primary CTA after every major section; keep CTA wording consistent site-wide.",
      "Reduce anxiety near CTAs with short reassurance lines grounded in verified facts (e.g. response time once confirmed) — never invented guarantees.",
      ...ctx.opportunityReasons.filter((r) => r.points > 0).slice(0, 5).map((r) => `Address: ${r.label} (${r.kind}).`),
    ]));
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function buildPages(ctx: PromptContext): PageSpec[] {
  const pb = ctx.playbook;
  const pages = [...pb.pages];
  // Replace generic service pages with verified services where we have them.
  if (ctx.servicesVerified.length && pb.family === "home_services") {
    const nonService = pages.filter((p) => !p.slug.startsWith("/services/"));
    const servicePages = ctx.servicesVerified.slice(0, 8).map((s) => ({
      name: s.name,
      slug: `/services/${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
      purpose: `Dedicated page for ${s.name} (verified on current website).`,
      sections: ["Service hero with H1 naming the service and area", "What's included (verified scope only)", "Process", "Real project photos", "FAQs", "Quote CTA pre-selecting this service"],
      cta: `Request a ${s.name.toLowerCase()} quote`,
    }));
    const idx = nonService.findIndex((p) => p.slug === "/services");
    nonService.splice(idx + 1, 0, ...servicePages);
    return nonService;
  }
  // Remove optional pages whose feature was explicitly removed.
  const removed = new Set(ctx.options.removeFeatures);
  return pages.filter((p) => !(removed.has("catering_events") && p.slug === "/catering") && !(removed.has("reservations") && p.slug === "/reservations") && !(removed.has("online_ordering") && p.slug === "/order"));
}

function heroH1(ctx: PromptContext) {
  const svc = ctx.servicesVerified[0]?.name ?? ctx.business.category ?? ctx.playbook.label;
  return ctx.city ? `${svc} in ${ctx.city}` : `${svc} by ${ctx.business.name}`;
}

function pageVisitor(p: PageSpec, ctx: PromptContext) {
  if (/quote|book|reserv|order|contact|enrol|consult/i.test(p.slug)) return "High-intent visitor ready to act — minimise friction.";
  if (/service|menu|program|rooms|package|shop/i.test(p.slug)) return `Comparison-stage visitor checking whether ${ctx.business.name} offers what they need.`;
  if (/about|team/i.test(p.slug)) return "Trust-seeking visitor deciding whether this business is credible.";
  if (/review|gallery|work/i.test(p.slug)) return "Visitor looking for proof of quality.";
  if (/area|location|visit/i.test(p.slug)) return "Local visitor confirming coverage, location or hours.";
  return "Visitors researching the business.";
}

function pageContent(p: PageSpec, ctx: PromptContext) {
  if (p.slug.startsWith("/services/")) {
    const v = ctx.servicesVerified.find((s) => p.name.toLowerCase().includes(s.name.toLowerCase()));
    return v ? `Expand on the verified service (“${v.evidence}”); all specifics beyond that are [BUSINESS OWNER TO PROVIDE].` : `[CONFIRM SERVICE OFFERED] — only publish this page if ${ctx.business.name} confirms it offers ${p.name.toLowerCase()}.`;
  }
  if (/review/.test(p.slug)) return "Real testimonials only ([ADD REAL TESTIMONIAL] ×3 minimum placeholders in staging).";
  if (/about/.test(p.slug)) return "[BUSINESS OWNER TO PROVIDE] story, values, team. Do not invent history.";
  if (/menu/.test(p.slug)) return "Full HTML menu from the business's current menu [BUSINESS TO PROVIDE MENU + PRICES].";
  if (/contact|visit/.test(p.slug)) return `Phone ${ctx.business.phone ?? "[PHONE]"}, email ${ctx.business.email ?? "[EMAIL]"}, address ${ctx.business.address ?? "[ADDRESS / SERVICE AREA]"}, hours ${ctx.business.hours.length ? "(verified, re-confirm)" : "[VERIFY HOURS]"}.`;
  return "Verified information plus clearly marked placeholders.";
}

function pageFunctionality(p: PageSpec, ctx: PromptContext) {
  if (/quote/.test(p.slug)) return "Multi-step quote form (section 11) with progress indicator and confirmation.";
  if (/reserv/.test(p.slug)) return "Reservation provider link/widget, lazy-loaded.";
  if (/order/.test(p.slug)) return "Links/buttons to verified ordering platforms.";
  if (/menu/.test(p.slug)) return "Sticky category navigation, anchor links, dietary filter (optional), print-friendly stylesheet.";
  if (/gallery|work/.test(p.slug)) return "Responsive image grid with accessible lightbox; optional category filter.";
  if (/contact|visit/.test(p.slug)) return "Contact form, tap-to-call, mailto, directions link, lazy-loaded map.";
  if (/faq/.test(p.slug)) return "Accessible accordion; FAQPage JSON-LD for approved answers.";
  if (/services\//.test(p.slug)) return `Service-specific CTA that pre-fills the ${ctx.playbook.primaryConversion.toLowerCase()} form with this service.`;
  return "Standard content components; CTA band.";
}

function pageTrust(p: PageSpec, ctx: PromptContext) {
  const t = ctx.playbook.trust;
  if (/about|team/.test(p.slug)) return t.filter((x) => /credential|licen|team|named|verified/i.test(x)).join("; ") || t[0]!;
  if (/quote|contact|book|reserv/.test(p.slug)) return "Short reassurance line (verified only), privacy note, alternative contact methods.";
  return t.slice(0, 3).join("; ");
}

function formsFor(ctx: PromptContext): FormSpec[] {
  const forms = [...ctx.playbook.forms];
  const hasContact = forms.some((f) => /contact/i.test(f.name));
  if (!hasContact) {
    forms.push({
      name: "General contact form",
      purpose: "Catch-all enquiries on the Contact page.",
      fields: [
        { label: "Full name", type: "text", required: true },
        { label: "Email", type: "email", required: true },
        { label: "Phone", type: "tel", required: false },
        { label: "Message", type: "textarea (10–2000 chars)", required: true },
      ],
    });
  }
  return forms;
}

const EVENT_DESCRIPTIONS: Record<string, string> = {
  cta_click: "any primary/secondary CTA click (param: cta_text, cta_location)",
  phone_click: "tap-to-call link clicked (param: location)",
  email_click: "mailto link clicked",
  quote_started: "first interaction with the quote form",
  quote_step_completed: "a quote form step validated (param: step)",
  quote_submitted: "quote form successfully submitted (conversion)",
  booking_started: "booking CTA/widget opened",
  booking_completed: "booking confirmed (via provider callback/redirect, if available) (conversion)",
  menu_view: "menu page viewed",
  menu_category_click: "menu category chip clicked (param: category)",
  order_online_click: "online ordering CTA clicked (param: platform) (conversion)",
  reservation_click: "reservation CTA clicked (conversion)",
  directions_click: "directions/map link clicked",
  contact_form_submitted: "contact form successfully submitted (conversion)",
  contact_submitted: "contact form successfully submitted (conversion)",
  catering_submitted: "catering enquiry submitted (conversion)",
  service_page_view: "a service detail page viewed (param: service)",
  service_view: "service details viewed (param: service)",
  gallery_open: "gallery lightbox opened",
  consultation_started: "consultation form started",
  consultation_submitted: "consultation request submitted (conversion)",
  tour_requested: "tour/enrolment enquiry submitted (conversion)",
  program_view: "program page viewed",
  assessment_requested: "assessment/trial request submitted (conversion)",
  event_enquiry_submitted: "event enquiry submitted (conversion)",
  availability_check: "availability search performed",
  trip_enquiry_submitted: "trip enquiry submitted (conversion)",
  shop_click: "shop/product CTA clicked",
  newsletter_signup: "newsletter signup completed",
};
const eventDescription = (e: string) => EVENT_DESCRIPTIONS[e] ?? "fire when this interaction completes";
