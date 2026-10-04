import "../guard";
import * as z from "zod";
import type { Business, Prisma, WebsiteStatus } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity } from "../activity";
import { changeLeadStatus, isSocialOrDirectoryUrl, normalizeWebsite } from "../leads";
import { resolveIntegrationKey } from "../workspace";
import { getAi } from "../ai/client";
import { classifyBusinessType } from "../intel/classify-type";
import { computeOpportunity } from "../intel/opportunity";
import { getPlaybook, type Playbook } from "../intel/playbooks";
import { analyzeHtml, pickPagesToCrawl, type PageData } from "./analyze";
import { classifySite, outdatedSignals, isSinglePage, type WebsiteClassT } from "./classify";
import { politeFetch } from "./fetcher";
import { runPageSpeed } from "./pagespeed";
import { fetchRobots } from "./robots";
import { buildFindings, detectFeatures, scoreSite, type FeaturePresence, type Finding, type SiteData } from "./score";

const MAX_EXTRA_PAGES = 5;
const MAX_LINK_CHECKS = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AuditOutcome = {
  auditId: string;
  websiteStatus: WebsiteStatus;
  classification: WebsiteClassT;
  overall: number | null;
  opportunity: number;
};

/** Facts extracted from the site; every item carries evidence that exists in the page text. */
export type ExtractedFacts = {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  headings: string[];
  platform: string | null;
  phones: string[];
  emails: string[];
  address: string | null;
  hours: string | null;
  socialLinks: Record<string, string>;
  ctas: string[];
  forms: { page: string; purpose: string; fields: string[] }[];
  pagesAnalysed: { url: string; title: string | null; words: number }[];
  copyrightYear: number | null;
  jsonLdTypes: string[];
  outdatedSignals: string[];
  singlePage: boolean;
  features: FeaturePresence[];
  ai?: { summary: string; services: { name: string; evidence: string }[]; differentiators: { claim: string; evidence: string }[]; tagline: string | null } | null;
  notes: string[];
};

export async function runWebsiteAudit(workspaceId: string, businessId: string, opts: { userId?: string | null; notifyOnComplete?: boolean } = {}): Promise<AuditOutcome> {
  const business = await db.business.findFirst({ where: { id: businessId, workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  const audit = await db.websiteAudit.create({
    data: { workspaceId, businessId, url: business.website, status: "RUNNING" },
  });
  const started = Date.now();
  try {
    const outcome = await performAudit(business, audit.id);
    await logActivity({
      workspaceId,
      userId: opts.userId,
      businessId,
      action: "audit.completed",
      summary: outcome.overall != null ? `Website audit completed — ${outcome.overall}/100 (${outcome.classification.replace("_", " ").toLowerCase()})` : `Website check completed — ${outcome.classification.replace("_", " ").toLowerCase()}`,
      details: { auditId: audit.id, opportunity: outcome.opportunity },
    });
    await db.websiteAudit.update({ where: { id: audit.id }, data: { durationMs: Date.now() - started } });
    return outcome;
  } catch (e) {
    await db.websiteAudit.update({ where: { id: audit.id }, data: { status: "FAILED", error: describeError(e).slice(0, 1000), completedAt: new Date(), durationMs: Date.now() - started } });
    throw e;
  }
}

async function performAudit(business: Business, auditId: string): Promise<AuditOutcome> {
  const site = normalizeWebsite(business.website);
  const typeGuess = classifyBusinessType({ category: business.category, name: business.name });
  const notes: string[] = [];

  // ── No website / social-only ──
  if (!site || isSocialOrDirectoryUrl(site.url)) {
    const state = site ? "SOCIAL_ONLY" : "NONE";
    const playbook = getPlaybook(business.businessTypeConfidence === 100 ? business.businessType : typeGuess.playbook.id);
    const findings: Finding[] = [
      {
        category: "functionality",
        severity: "CRITICAL",
        kind: "VERIFIED",
        code: state === "NONE" ? "site.none" : "site.social_only",
        title: state === "NONE" ? "No website found" : "Only a social/directory profile is listed",
        detail:
          state === "NONE"
            ? `No website is listed in the ${business.source === "GOOGLE_PLACES" ? "Google Places listing" : "lead record"}. Customers searching online cannot find details, ${playbook.primaryConversion.toLowerCase()} options, or proof of quality on a site the business controls.`
            : `The listed website (${site!.url}) is a third-party profile, which the business does not fully control and which offers limited ${playbook.primaryConversion.toLowerCase()} functionality.`,
        evidence: site?.url,
      },
    ];
    return finalise(business, auditId, {
      websiteStatus: "NO_WEBSITE",
      classification: "NO_WEBSITE",
      state,
      playbook,
      typeConfidence: business.businessTypeConfidence === 100 ? 100 : typeGuess.confidence,
      findings,
      notes,
      url: site?.url ?? null,
    });
  }

  // ── Robots ──
  const startUrl = new URL(site.url);
  const robots = await fetchRobots(startUrl.origin);
  if (!robots.isAllowed(startUrl.pathname || "/")) {
    return blockedOutcome(business, auditId, site.url, "robots.txt disallows automated access to this site. It was not crawled — review it manually.", typeGuess);
  }

  // ── Homepage ──
  let homeRes;
  try {
    homeRes = await politeFetch(site.url);
  } catch (e) {
    const err = e as AppError;
    if (err.code === "BLOCKED") return blockedOutcome(business, auditId, site.url, err.message, typeGuess);
    return unavailableOutcome(business, auditId, site.url, err.message, typeGuess);
  }
  if ([401, 403, 407, 429, 451].includes(homeRes.status)) {
    return blockedOutcome(business, auditId, homeRes.finalUrl, `The website refused automated access (HTTP ${homeRes.status}). It was not bypassed — review manually.`, typeGuess);
  }
  if (homeRes.status >= 400) {
    return unavailableOutcome(business, auditId, homeRes.finalUrl, `The website returned HTTP ${homeRes.status}.`, typeGuess);
  }
  const ctype = homeRes.headers["content-type"] ?? "";
  if (ctype && !/html/i.test(ctype)) {
    return blockedOutcome(business, auditId, homeRes.finalUrl, `The website returned ${ctype} instead of a web page.`, typeGuess, "MANUAL_REVIEW");
  }
  const home = analyzeHtml(homeRes.body, { url: homeRes.finalUrl, status: homeRes.status, ms: homeRes.ms, bytes: homeRes.bytes, headers: homeRes.headers });
  if (home.challengeSignals.length || (home.hasPasswordField && home.wordCount < 150)) {
    return blockedOutcome(business, auditId, homeRes.finalUrl, `${home.challengeSignals[0] ?? "Login wall"} detected. Automated checks were stopped (no bypass attempted).`, typeGuess);
  }

  // ── Additional pages (polite, robots-aware) ──
  const pages: PageData[] = [];
  const delay = Math.min(Math.max((robots.crawlDelay ?? 0) * 1000, 400), 3000);
  for (const url of pickPagesToCrawl(home, MAX_EXTRA_PAGES)) {
    const u = new URL(url);
    if (!robots.isAllowed(u.pathname)) {
      notes.push(`Skipped ${u.pathname} (disallowed by robots.txt)`);
      continue;
    }
    await sleep(delay);
    try {
      const r = await politeFetch(url, { timeoutMs: 10000 });
      if (r.status >= 400 || !/html/i.test(r.headers["content-type"] ?? "text/html")) continue;
      pages.push(analyzeHtml(r.body, { url: r.finalUrl, status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers }));
    } catch (e) {
      notes.push(`Could not load ${u.pathname}: ${describeError(e)}`);
    }
  }

  // ── Broken link sample ──
  const crawled = new Set([home.url, ...pages.map((p) => p.url)].map((u) => u.replace(/\/$/, "")));
  const toCheck = Array.from(new Set([home, ...pages].flatMap((p) => p.internalLinks.map((l) => l.href))))
    .filter((u) => !crawled.has(u.replace(/\/$/, "")) && !/\.(pdf|jpe?g|png|gif|zip)$/i.test(u) && robots.isAllowed(new URL(u).pathname))
    .slice(0, MAX_LINK_CHECKS);
  const brokenLinks: SiteData["brokenLinks"] = [];
  for (const u of toCheck) {
    await sleep(150);
    try {
      let r = await politeFetch(u, { method: "HEAD", timeoutMs: 8000 });
      if (r.status === 405 || r.status === 501) r = await politeFetch(u, { timeoutMs: 8000 });
      if (r.status >= 400 && ![401, 403, 429].includes(r.status)) brokenLinks.push({ url: u, status: r.status });
    } catch (e) {
      const err = e as AppError;
      if (err.code !== "UPSTREAM_TIMEOUT" && err.code !== "BLOCKED") brokenLinks.push({ url: u, status: err.code });
    }
  }

  // ── Lighthouse (optional) ──
  const googleKey = await resolveIntegrationKey(business.workspaceId, "GOOGLE_PLACES").catch(() => null);
  const { psi, note } = await runPageSpeed(homeRes.finalUrl, googleKey?.key ?? null);
  if (note) notes.push(note);

  const siteData: SiteData = {
    home,
    pages,
    https: homeRes.finalUrl.startsWith("https://"),
    httpsRedirect: site.url.startsWith("http://") && homeRes.finalUrl.startsWith("https://"),
    brokenLinks,
    linksChecked: toCheck.length,
    psi,
    city: business.city,
  };

  // ── Business type (now with website text) ──
  const allText = [home, ...pages].map((p) => `${p.title ?? ""} ${p.h1.join(" ")} ${p.h2.join(" ")} ${p.text}`).join(" ");
  // A type set manually by a user (confidence 100) is never overridden by heuristics.
  const typed =
    business.businessType && business.businessTypeConfidence === 100
      ? { playbook: getPlaybook(business.businessType), confidence: 100 }
      : classifyBusinessType({ category: business.category, name: business.name, siteText: allText });
  const playbook = typed.playbook;

  const features = detectFeatures(playbook, siteData);
  const { scores, breakdown, overall } = scoreSite(siteData, features);
  const findings = buildFindings(siteData, breakdown, features);
  const cls = classifySite(siteData, overall);

  const extracted: ExtractedFacts = {
    title: home.title,
    metaDescription: home.metaDescription,
    h1: home.h1,
    headings: Array.from(new Set([home, ...pages].flatMap((p) => [...p.h2, ...p.h3]))).slice(0, 40),
    platform: home.platform,
    phones: Array.from(new Set([home, ...pages].flatMap((p) => p.telLinks))).slice(0, 5),
    emails: pickBusinessEmails([home, ...pages], site.domain),
    address: home.addressLike ?? pages.find((p) => p.addressLike)?.addressLike ?? null,
    hours: home.hoursLike ?? pages.find((p) => p.hoursLike)?.hoursLike ?? null,
    socialLinks: Object.assign({}, ...[home, ...pages].map((p) => p.socialLinks).reverse()),
    ctas: Array.from(new Set([home, ...pages].flatMap((p) => p.ctaTexts))).slice(0, 15),
    forms: [home, ...pages].flatMap((p) => p.forms.map((f) => ({ page: p.url, purpose: f.purpose, fields: f.fields.map((x) => x.label || x.name).filter(Boolean) }))),
    pagesAnalysed: [home, ...pages].map((p) => ({ url: p.url, title: p.title, words: p.wordCount })),
    copyrightYear: home.copyrightYear,
    jsonLdTypes: home.jsonLdTypes,
    outdatedSignals: outdatedSignals(siteData),
    singlePage: isSinglePage(siteData),
    features,
    ai: null,
    notes,
  };

  // ── Optional AI fact extraction (evidence-checked) ──
  const settings = await db.automationSettings.findUnique({ where: { workspaceId: business.workspaceId } });
  if (settings?.aiWebsiteAnalysis !== false) {
    try {
      extracted.ai = await extractFactsWithAi(business, allText);
    } catch (e) {
      notes.push(`AI fact extraction skipped: ${describeError(e)}`);
    }
  }

  return finalise(business, auditId, {
    websiteStatus: "WEBSITE_FOUND",
    classification: cls.classification,
    classificationReasons: cls.reasons,
    state: "ANALYSED",
    playbook,
    typeConfidence: typed.confidence,
    findings,
    notes,
    url: homeRes.finalUrl,
    overall,
    scores,
    breakdown,
    extracted,
    performance: psi,
    https: siteData.https,
    features,
  });
}

function pickBusinessEmails(pages: PageData[], domain: string | null) {
  const all = Array.from(new Set(pages.flatMap((p) => [...p.mailtoEmails, ...p.textEmails])));
  const onDomain = domain ? all.filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)) : [];
  return (onDomain.length ? onDomain : all).slice(0, 5);
}

const AiFactsSchema = z.object({
  summary: z.string(),
  tagline: z.string().nullable(),
  services: z.array(z.object({ name: z.string(), evidence: z.string() })),
  differentiators: z.array(z.object({ claim: z.string(), evidence: z.string() })),
});

async function extractFactsWithAi(business: Business, siteText: string) {
  const ai = await getAi(business.workspaceId);
  if (!ai) return null;
  const text = siteText.replace(/\s+/g, " ").slice(0, 24000);
  const result = await ai.json({
    feature: "website_fact_extraction",
    system:
      "You extract VERIFIED facts about a local business from its own website text. Only include a service or differentiator if the website text explicitly states it, and copy a short exact quote (5–20 words) from the text as evidence. Never infer, embellish, or add anything not in the text. If unsure, omit it.",
    prompt: `Business name: ${business.name}\nWebsite text (truncated):\n"""${text}"""\n\nReturn: a neutral 1–2 sentence summary of what the website says the business does (no marketing language, nothing not stated), the site's own tagline if present (exact text) or null, the services explicitly offered, and explicit differentiators/claims the business makes about itself.`,
    schema: AiFactsSchema,
    maxTokens: 4000,
  });
  // Anti-hallucination: keep only items whose evidence actually appears in the text.
  const hay = text.toLowerCase();
  const present = (q: string) => q.trim().length >= 4 && hay.includes(q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60));
  return {
    summary: result.summary,
    tagline: result.tagline && hay.includes(result.tagline.toLowerCase().slice(0, 40)) ? result.tagline : null,
    services: result.services.filter((s) => present(s.evidence)).slice(0, 20),
    differentiators: result.differentiators.filter((d) => present(d.evidence)).slice(0, 10),
  };
}

async function blockedOutcome(business: Business, auditId: string, url: string, reason: string, typeGuess: { playbook: Playbook; confidence: number }, status: WebsiteStatus = "WEBSITE_BLOCKED") {
  return finalise(business, auditId, {
    websiteStatus: status,
    classification: "MANUAL_REVIEW",
    state: "BLOCKED",
    playbook: getPlaybook(business.businessTypeConfidence === 100 ? business.businessType : typeGuess.playbook.id),
    typeConfidence: business.businessTypeConfidence === 100 ? 100 : typeGuess.confidence,
    findings: [{ category: "functionality", severity: "MEDIUM", kind: "UNKNOWN", code: "site.manual_review", title: "Manual review required", detail: reason, evidence: url }],
    notes: [reason],
    url,
  });
}

async function unavailableOutcome(business: Business, auditId: string, url: string, reason: string, typeGuess: { playbook: Playbook; confidence: number }) {
  return finalise(business, auditId, {
    websiteStatus: "WEBSITE_UNAVAILABLE",
    classification: "BROKEN",
    state: "UNAVAILABLE",
    playbook: getPlaybook(business.businessTypeConfidence === 100 ? business.businessType : typeGuess.playbook.id),
    typeConfidence: business.businessTypeConfidence === 100 ? 100 : typeGuess.confidence,
    findings: [{ category: "functionality", severity: "CRITICAL", kind: "VERIFIED", code: "site.unavailable", title: "Website unavailable", detail: `${reason} Visitors following the listing link would hit an error.`, evidence: url }],
    notes: [reason],
    url,
  });
}

async function finalise(
  business: Business,
  auditId: string,
  r: {
    websiteStatus: WebsiteStatus;
    classification: WebsiteClassT;
    classificationReasons?: string[];
    state: "NONE" | "SOCIAL_ONLY" | "UNAVAILABLE" | "BLOCKED" | "ANALYSED";
    playbook: Playbook;
    typeConfidence: number;
    findings: Finding[];
    notes: string[];
    url: string | null;
    overall?: number;
    scores?: Record<string, number>;
    breakdown?: unknown;
    extracted?: ExtractedFacts;
    performance?: unknown;
    https?: boolean;
    features?: FeaturePresence[];
  },
): Promise<AuditOutcome> {
  const opp = computeOpportunity({
    playbook: r.playbook,
    websiteState: r.state,
    classification: r.classification,
    overall: r.overall ?? null,
    scores: r.scores ?? null,
    features: r.features ?? null,
    https: r.https ?? null,
    business,
  });
  const summary =
    r.state === "ANALYSED"
      ? `${r.classification.replace("_", "-").toLowerCase()} website scoring ${r.overall}/100 across ${r.extracted?.pagesAnalysed.length ?? 1} analysed page(s). ${r.classificationReasons?.join("; ") ?? ""}`
      : r.findings[0]?.detail ?? "";
  const extracted = r.extracted ?? ({ notes: r.notes } as unknown as ExtractedFacts);

  await db.$transaction(async (tx) => {
    await tx.websiteAudit.update({
      where: { id: auditId },
      data: {
        status: "COMPLETED",
        finalUrl: r.url,
        websiteStatus: r.websiteStatus,
        classification: r.classification,
        overallScore: r.overall ?? null,
        scores: (r.scores ?? {}) as Prisma.InputJsonValue,
        scoreBreakdown: (r.breakdown ?? {}) as Prisma.InputJsonValue,
        extracted: extracted as unknown as Prisma.InputJsonValue,
        pages: (r.extracted?.pagesAnalysed ?? []) as Prisma.InputJsonValue,
        performance: (r.performance ?? undefined) as Prisma.InputJsonValue | undefined,
        summary,
        aiSummary: r.extracted?.ai?.summary ?? null,
        completedAt: new Date(),
        findings: { create: r.findings.map((f) => ({ category: f.category, severity: f.severity, kind: f.kind, code: f.code, title: f.title, detail: f.detail, evidence: f.evidence ?? null })) },
      },
    });
    await tx.opportunity.create({
      data: {
        workspaceId: business.workspaceId,
        businessId: business.id,
        auditId,
        score: opp.score,
        businessType: r.playbook.id,
        reasons: opp.reasons as unknown as Prisma.InputJsonValue,
        recommendedFeatures: opp.recommended as unknown as Prisma.InputJsonValue,
        summary: opp.summary,
      },
    });
    const patch: Prisma.BusinessUpdateInput = {
      websiteStatus: r.websiteStatus,
      websiteClass: r.classification,
      websiteScore: r.overall ?? null,
      opportunityScore: opp.score,
      businessType: r.playbook.id,
      businessTypeConfidence: r.typeConfidence,
    };
    const ex = r.extracted;
    if (ex) {
      if (!business.email && ex.emails[0]) {
        patch.email = ex.emails[0];
        patch.emailSource = `Publicly listed on website (${r.url})`;
        await tx.contact.create({ data: { workspaceId: business.workspaceId, businessId: business.id, email: ex.emails[0], source: `Website: ${r.url}`, isPrimary: true } });
      }
      if (Object.keys(ex.socialLinks).length) patch.socialLinks = { ...(business.socialLinks as object), ...ex.socialLinks };
      if (!business.phone && ex.phones[0]) patch.phone = ex.phones[0];
    }
    await tx.business.update({ where: { id: business.id }, data: patch });
  });

  await changeLeadStatus({ workspaceId: business.workspaceId, businessId: business.id, to: opp.score >= 70 ? "HIGH_OPPORTUNITY" : "RESEARCHED", automatic: true, reason: "Website audit completed" });
  return { auditId, websiteStatus: r.websiteStatus, classification: r.classification, overall: r.overall ?? null, opportunity: opp.score };
}
