import "../guard";
import dns from "node:dns/promises";
import type { Business, Contact } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity } from "../activity";
import { getSettings } from "../workspace";
import { isSocialOrDirectoryUrl, isSuppressed, normalizeWebsite } from "../leads";
import { politeFetch } from "../audit/fetcher";
import { fetchRobots } from "../audit/robots";
import { analyzeHtml } from "../audit/analyze";

/**
 * Finds publicly listed business email addresses on a business's own website,
 * records where each was found, validates it, and decides — with recorded
 * evidence — whether it may receive commercial email under CASL.
 * Never guesses addresses (no "info@" assumptions) and never bypasses robots.txt.
 */

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const IGNORED = /(example\.|sentry|wixpress|noreply|no-reply|donotreply|mailer-daemon|@sentry|\.png$|\.jpg$|\.gif$|\.webp$|u003e|domain\.com$|email\.com$|yourname|your-?email)/i;
const NO_SOLICITATION = /(no|not accept|do not send|don't send|we do not (?:accept|want)|please do not send)\s+(?:any\s+)?(unsolicited|commercial|marketing|sales|promotional)|\bno solicit(?:ation|ations|ing|ors)\b|not (?:wish|want) to receive (?:any\s+)?(?:unsolicited|commercial|marketing)|solicitations? (?:are|is) not (?:accepted|welcome)/i;

export type RoleInfo = { role: string; relevant: boolean; named: boolean };

/** What an address is for, judged only from its local part. */
export function emailRole(email: string): RoleInfo {
  const local = email.split("@")[0]!.toLowerCase();
  const is = (re: RegExp) => re.test(local);
  if (is(/^(info|hello|hi|contact|contactus|enquir|inquir|general|office|mail|team|bookings?|appointments?|reception|admin|frontdesk)/)) return { role: is(/^(office|admin|reception|frontdesk)/) ? "Office administration" : "General business inquiries", relevant: true, named: false };
  if (is(/^(sales|quotes?|estimates?|orders?|business|bizdev)/)) return { role: "Sales", relevant: true, named: false };
  if (is(/^(marketing|media|press|pr|social|web|website|digital)/)) return { role: "Marketing", relevant: true, named: false };
  if (is(/^(owner|manager|management|director|ceo|president|principal|gm)/)) return { role: "Business management", relevant: true, named: false };
  if (is(/^(careers?|jobs?|hr|hiring|recruit|resumes?|cv)/)) return { role: "Careers / HR", relevant: false, named: false };
  if (is(/^(privacy|legal|compliance|dpo|abuse|security)/)) return { role: "Legal / privacy", relevant: false, named: false };
  if (is(/^(support|help|service|returns|warranty|billing|accounts?|invoices?|ar|ap|payments?|finance)/)) return { role: "Customer support / billing", relevant: false, named: false };
  if (is(/^(webmaster|postmaster|hostmaster|noreply|no-reply|donotreply|bounce)/)) return { role: "Technical / system", relevant: false, named: false };
  if (is(/^[a-z]+[._-][a-z]+$/) || is(/^[a-z]{2,15}$/)) return { role: "Named individual", relevant: true, named: true };
  return { role: "Business contact", relevant: true, named: false };
}

export type Eligibility = { eligibility: "ELIGIBLE" | "NEEDS_REVIEW" | "INELIGIBLE"; basis: string; reason: string };

/** CASL decision with a human-readable reason. Pure — every input is recorded as evidence. */
export function evaluateEligibility(i: {
  classification: string; verification: string; role: RoleInfo; noSolicitation: boolean; suppressed: boolean; doNotContact: boolean;
  expressConsent: boolean; checksEnabled: boolean; sourceUrl: string | null;
}): Eligibility {
  if (i.suppressed) return { eligibility: "INELIGIBLE", basis: "NONE", reason: "Address is on the suppression list (unsubscribed or marked Do Not Contact)." };
  if (i.doNotContact) return { eligibility: "INELIGIBLE", basis: "NONE", reason: "The business is marked Do Not Contact." };
  if (i.classification === "INVALID" || i.verification === "INVALID") return { eligibility: "INELIGIBLE", basis: "NONE", reason: "The address failed validation (bad format or the domain cannot receive email)." };
  if (i.expressConsent) return { eligibility: "ELIGIBLE", basis: "EXPRESS", reason: "Express consent recorded by a team member." };
  if (!i.checksEnabled) return { eligibility: "NEEDS_REVIEW", basis: "NONE", reason: "Eligibility checks are turned off — review consent manually before sending." };
  if (i.noSolicitation) return { eligibility: "INELIGIBLE", basis: "NONE", reason: "The page where this address is published says the business does not want unsolicited commercial messages." };
  if (!i.role.relevant) return { eligibility: "INELIGIBLE", basis: "NONE", reason: `This is a ${i.role.role.toLowerCase()} address; a website-services message is not relevant to that role.` };
  if (i.classification === "VERIFIED_PUBLIC") {
    if (i.role.named) return { eligibility: "NEEDS_REVIEW", basis: "IMPLIED_CONSPICUOUS_PUBLICATION", reason: "A named person's address published on the business site — confirm it is published for business inquiries before sending." };
    return {
      eligibility: "ELIGIBLE",
      basis: "IMPLIED_CONSPICUOUS_PUBLICATION",
      reason: `Conspicuously published on the business's own website${i.sourceUrl ? ` (${i.sourceUrl})` : ""}, with no statement refusing unsolicited messages, and a website-services message relates to the business's role.`,
    };
  }
  if (i.classification === "PUBLIC_DIRECTORY") return { eligibility: "NEEDS_REVIEW", basis: "NONE", reason: "Found in a public directory, which may not have been published by the business itself — confirm before sending." };
  if (i.classification === "LICENSED_PROVIDER") return { eligibility: "NEEDS_REVIEW", basis: "NONE", reason: "Returned by a data provider — confirm the consent basis the provider documents before sending." };
  return { eligibility: "NEEDS_REVIEW", basis: "NONE", reason: "No documented consent basis yet — confirm consent (or record express consent) before sending." };
}

// ───────────── Validation ─────────────

let mxResolver: (domain: string) => Promise<{ exchange: string }[]> = (d) => dns.resolveMx(d);
/** Tests: replace the MX lookup. */
export function setMxResolverForTests(fn: ((domain: string) => Promise<{ exchange: string }[]>) | null) {
  mxResolver = fn ?? ((d) => dns.resolveMx(d));
}

const mxCache = new Map<string, { ok: boolean | null; note: string; at: number }>();
export async function checkMx(domain: string): Promise<{ ok: boolean | null; note: string }> {
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit;
  let r: { ok: boolean | null; note: string };
  try {
    const mx = await mxResolver(domain);
    r = mx.length ? { ok: true, note: `Domain accepts email (${mx.length} mail server${mx.length === 1 ? "" : "s"}).` } : { ok: false, note: "Domain has no mail servers." };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    r = ["ENOTFOUND", "ENODATA", "NXDOMAIN"].includes(code) ? { ok: false, note: "Domain has no mail servers (DNS lookup found none)." } : { ok: null, note: `Mail-server check inconclusive (${code || describeError(e)}).` };
  }
  mxCache.set(domain, { ...r, at: Date.now() });
  return r;
}

// ───────────── Website crawl ─────────────

type Found = { email: string; sourceUrl: string; snippet: string; noSolicitation: boolean };

const CONTACT_LINK = /contact|about|reach|get-in-touch|location|team|staff|connect/i;

async function crawlForEmails(siteUrl: string): Promise<{ found: Found[]; notes: string[] }> {
  const notes: string[] = [];
  const start = new URL(siteUrl);
  const robots = await fetchRobots(start.origin);
  if (!robots.isAllowed(start.pathname || "/")) return { found: [], notes: ["robots.txt disallows automated access — the site was not checked."] };
  const delay = Math.min(Math.max((robots.crawlDelay ?? 0) * 1000, 500), 3000);
  const found: Found[] = [];
  const visit = async (url: string) => {
    const r = await politeFetch(url, { timeoutMs: 12000 });
    if ([401, 403, 407, 429, 451].includes(r.status)) {
      notes.push(`${new URL(r.finalUrl).pathname} refused automated access (HTTP ${r.status}); not bypassed.`);
      return null;
    }
    if (r.status >= 400 || !/html/i.test(r.headers["content-type"] ?? "text/html")) return null;
    const page = analyzeHtml(r.body, { url: r.finalUrl, status: r.status, ms: r.ms, bytes: r.bytes, headers: r.headers });
    const text = page.text.replace(/\s+/g, " ");
    const noSolicitation = NO_SOLICITATION.test(text);
    for (const email of Array.from(new Set([...page.mailtoEmails, ...page.textEmails]))) {
      const e = email.toLowerCase().trim();
      if (!EMAIL_RE.test(e) || IGNORED.test(e)) continue;
      const at = text.toLowerCase().indexOf(e);
      found.push({ email: e, sourceUrl: r.finalUrl, snippet: at >= 0 ? text.slice(Math.max(0, at - 80), at + e.length + 80).trim() : `Linked as mailto:${e}`, noSolicitation });
    }
    return page;
  };
  let home;
  try {
    home = await visit(siteUrl);
  } catch (e) {
    return { found, notes: [`Could not load the website: ${describeError(e)}`] };
  }
  if (!home) return { found, notes: notes.length ? notes : ["The website did not return a readable page."] };
  const links = home.internalLinks.filter((l) => CONTACT_LINK.test(`${l.href} ${l.text}`)).map((l) => l.href.split("#")[0]!);
  const candidates = Array.from(new Set(links)).slice(0, 3);
  if (!candidates.length) candidates.push(new URL("/contact", start.origin).toString(), new URL("/contact-us", start.origin).toString());
  for (const u of candidates) {
    const path = new URL(u).pathname;
    if (!robots.isAllowed(path)) {
      notes.push(`Skipped ${path} (disallowed by robots.txt).`);
      continue;
    }
    await new Promise((r) => setTimeout(r, delay));
    try {
      await visit(u);
    } catch (e) {
      notes.push(`Could not load ${path}: ${describeError(e)}`);
    }
  }
  // The strongest evidence per address: a page without a no-solicitation statement wins.
  const best = new Map<string, Found>();
  for (const f of found) {
    const prev = best.get(f.email);
    if (!prev || (prev.noSolicitation && !f.noSolicitation)) best.set(f.email, f);
  }
  return { found: Array.from(best.values()).slice(0, 10), notes };
}

// ───────────── Orchestration ─────────────

const ROLE_RANK = ["General business inquiries", "Sales", "Office administration", "Marketing", "Business management", "Business contact", "Named individual"];

/** Re-evaluates one contact's eligibility and records the evidence when the decision changes. */
async function evaluateContact(c: Contact, business: Business, ctx: { checksEnabled: boolean; noSolicitation?: boolean; snippet?: string | null }) {
  const email = c.email!.toLowerCase();
  const domain = email.split("@")[1]!;
  const syntaxOk = EMAIL_RE.test(email);
  const mx = syntaxOk ? await checkMx(domain) : { ok: false, note: "Invalid address format." };
  const verification = !syntaxOk || mx.ok === false ? "INVALID" : mx.ok ? "VALID" : "UNVERIFIED";
  const role = emailRole(email);
  const express = await db.consentRecord.findFirst({ where: { workspaceId: c.workspaceId, email, basis: "EXPRESS", withdrawnAt: null }, select: { id: true } });
  const noSolicitation = ctx.noSolicitation ?? (await db.consentRecord.findFirst({ where: { contactId: c.id }, orderBy: { createdAt: "desc" }, select: { evidence: true } }).then((r) => Boolean((r?.evidence as { noSolicitation?: boolean } | null)?.noSolicitation)));
  const decision = evaluateEligibility({
    classification: syntaxOk ? c.classification : "INVALID", verification, role, noSolicitation: Boolean(noSolicitation),
    suppressed: Boolean(await isSuppressed(c.workspaceId, email)), doNotContact: business.doNotContact,
    expressConsent: Boolean(express), checksEnabled: ctx.checksEnabled, sourceUrl: c.sourceUrl,
  });
  const changed = decision.eligibility !== c.eligibility || decision.basis !== c.consentBasis;
  const updated = await db.contact.update({
    where: { id: c.id },
    data: { verification, mxValid: mx.ok, verificationNote: mx.note, role: c.role && c.role !== "General business inquiries" && !role.named ? c.role : role.role, eligibility: decision.eligibility, eligibilityReason: decision.reason, consentBasis: decision.basis, lastCheckedAt: new Date(), ...(ctx.snippet ? { sourceSnippet: ctx.snippet.slice(0, 300) } : {}) },
  });
  if (changed) {
    await db.consentRecord.create({
      data: {
        workspaceId: c.workspaceId, businessId: business.id, contactId: c.id, email, basis: decision.basis, eligible: decision.eligibility === "ELIGIBLE", reason: decision.reason, sourceUrl: c.sourceUrl,
        evidence: { classification: c.classification, verification, mx: mx.note, role: role.role, roleRelevant: role.relevant, noSolicitation, checkedAt: new Date().toISOString(), snippet: ctx.snippet ?? c.sourceSnippet ?? null },
      },
    });
  }
  return updated;
}

export async function discoverContacts(workspaceId: string, businessId: string, opts: { userId?: string | null; crawl?: boolean } = {}) {
  const business = await db.business.findFirst({ where: { id: businessId, workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  const { automation } = await getSettings(workspaceId);
  const notes: string[] = [];
  const site = normalizeWebsite(business.website);
  const discovered: Found[] = [];
  if (opts.crawl !== false && site && !isSocialOrDirectoryUrl(site.url)) {
    const r = await crawlForEmails(site.url);
    discovered.push(...r.found);
    notes.push(...r.notes);
  } else if (!site) notes.push("No website on file — nothing to check (no addresses are guessed).");
  else if (isSocialOrDirectoryUrl(site.url)) notes.push("The listed website is a social/directory page; it was not crawled.");

  // Save newly found addresses (never overwrite a manually entered contact's source).
  const existing = await db.contact.findMany({ where: { businessId, email: { not: null } } });
  const known = new Set(existing.map((c) => c.email!.toLowerCase()));
  for (const f of discovered) {
    const prev = existing.find((c) => c.email?.toLowerCase() === f.email);
    if (prev) {
      if (prev.classification !== "MANUAL") await db.contact.update({ where: { id: prev.id }, data: { classification: "VERIFIED_PUBLIC", sourceUrl: f.sourceUrl, sourceSnippet: f.snippet.slice(0, 300), source: "Publicly listed on the business website" } });
    } else {
      existing.push(await db.contact.create({ data: { workspaceId, businessId, email: f.email, source: "Publicly listed on the business website", classification: "VERIFIED_PUBLIC", sourceUrl: f.sourceUrl, sourceSnippet: f.snippet.slice(0, 300), role: emailRole(f.email).role } }));
    }
  }

  // Validate + decide eligibility for every known address (website, directory, manual).
  const evaluated: Contact[] = [];
  for (const c of await db.contact.findMany({ where: { businessId, email: { not: null } } })) {
    const f = discovered.find((d) => d.email === c.email!.toLowerCase());
    evaluated.push(await evaluateContact(c, business, { checksEnabled: automation.eligibilityChecksEnabled, noSolicitation: f?.noSolicitation, snippet: f?.snippet }));
  }

  // Primary address: the best usable one.
  const usable = evaluated.filter((c) => c.eligibility !== "INELIGIBLE");
  const pick = usable.sort((a, b) => (a.eligibility === "ELIGIBLE" ? 0 : 1) - (b.eligibility === "ELIGIBLE" ? 0 : 1) || ROLE_RANK.indexOf(a.role ?? "") - ROLE_RANK.indexOf(b.role ?? ""))[0];
  if (pick) {
    await db.contact.updateMany({ where: { businessId, id: { not: pick.id } }, data: { isPrimary: false } });
    await db.contact.update({ where: { id: pick.id }, data: { isPrimary: true } });
    if (!business.email || evaluated.find((c) => c.email === business.email)?.eligibility === "INELIGIBLE") {
      await db.business.update({ where: { id: businessId }, data: { email: pick.email, emailSource: pick.classification === "VERIFIED_PUBLIC" ? `Publicly listed on the business website (${pick.sourceUrl ?? "website"})` : pick.source } });
    }
  }
  const newCount = discovered.filter((f) => !known.has(f.email)).length;
  await logActivity({ workspaceId, userId: opts.userId ?? null, businessId, action: "contacts.discovered", summary: `Contact search: ${discovered.length} public email${discovered.length === 1 ? "" : "s"} found on the website; ${evaluated.filter((c) => c.eligibility === "ELIGIBLE").length} eligible for outreach` });
  return {
    found: discovered.length,
    newCount,
    total: evaluated.length,
    eligible: evaluated.filter((c) => c.eligibility === "ELIGIBLE").length,
    needsReview: evaluated.filter((c) => c.eligibility === "NEEDS_REVIEW").length,
    valid: evaluated.filter((c) => c.verification === "VALID").length,
    primary: pick?.email ?? null,
    notes,
  };
}

/** A team member documents express consent (e.g. the business asked to be contacted). */
export async function recordExpressConsent(workspaceId: string, contactId: string, userId: string, note: string) {
  const c = await db.contact.findFirst({ where: { id: contactId, workspaceId, email: { not: null } }, include: { business: true } });
  if (!c) throw new AppError("NOT_FOUND", "Contact not found.");
  await db.consentRecord.create({ data: { workspaceId, businessId: c.businessId, contactId: c.id, email: c.email!.toLowerCase(), basis: "EXPRESS", eligible: true, reason: `Express consent recorded: ${note}`, recordedById: userId, evidence: { note, recordedAt: new Date().toISOString() } } });
  const { automation } = await getSettings(workspaceId);
  await evaluateContact(c, c.business, { checksEnabled: automation.eligibilityChecksEnabled });
  await logActivity({ workspaceId, userId, businessId: c.businessId, action: "consent.express_recorded", summary: `Express consent recorded for ${c.email}: ${note}` });
}

/** Consent withdrawn (unsubscribe): every record and contact for the address becomes ineligible. */
export async function withdrawConsent(workspaceId: string, email: string, reason: string) {
  const lower = email.toLowerCase();
  await db.consentRecord.updateMany({ where: { workspaceId, email: lower, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
  await db.contact.updateMany({ where: { workspaceId, email: lower }, data: { eligibility: "INELIGIBLE", eligibilityReason: reason, consentBasis: "NONE", lastCheckedAt: new Date() } });
}

/** Eligibility of an outreach recipient (used by the queue and automated sending). */
export async function recipientEligibility(workspaceId: string, businessId: string | null, email: string) {
  const c = await db.contact.findFirst({ where: { workspaceId, email: email.toLowerCase(), ...(businessId ? { businessId } : {}) }, orderBy: { lastCheckedAt: { sort: "desc", nulls: "last" } } });
  if (await isSuppressed(workspaceId, email)) return { eligibility: "INELIGIBLE", basis: "NONE", reason: "On the suppression list.", contactId: c?.id ?? null };
  if (!c) return { eligibility: "NEEDS_REVIEW", basis: "NONE", reason: "No contact record — consent not documented.", contactId: null };
  return { eligibility: c.eligibility, basis: c.consentBasis ?? "NONE", reason: c.eligibilityReason ?? "", contactId: c.id };
}
