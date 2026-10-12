import "./guard";
import * as z from "zod";
import { db } from "../db";
import { AppError, describeError } from "./errors";
import { getAi } from "./ai/client";
import { getSettings } from "./workspace";
import { getPlaybook } from "./intel/playbooks";
import { outreachObservations } from "./email/observations";
import { scanCommitments } from "./email/safety";

async function leadWithAudit(workspaceId: string, businessId: string) {
  const business = await db.business.findFirst({ where: { id: businessId, workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  const audit = await db.websiteAudit.findFirst({ where: { businessId, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, include: { findings: true } });
  const opp = await db.opportunity.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } });
  const missing = ((opp?.recommendedFeatures as { name: string; priority: string; status: string }[] | undefined) ?? []).filter((f) => f.status !== "present");
  return { business, audit, missing };
}

/**
 * A phone script for this lead built only from verified audit findings and the
 * agency's own profile (no AI, no invented facts) — useful for leads without an email.
 */
export async function buildCallScript(workspaceId: string, businessId: string) {
  const { business: b, audit, missing } = await leadWithAudit(workspaceId, businessId);
  const { company } = await getSettings(workspaceId);
  const pb = getPlaybook(b.businessType);
  const me = company.senderName?.split(" ")[0] || "[your name]";
  const agency = company.companyName || "[your agency]";
  const observations = outreachObservations(b, audit).slice(0, 3);
  const goal = pb.primaryConversion.toLowerCase();
  const essentials = missing.filter((f) => f.priority === "essential").slice(0, 3).map((f) => f.name);
  const hasCare = /care|manage|maint|hosting|update/i.test(`${company.services.join(" ")} ${company.pricingDetails}`);
  return {
    phone: b.phone,
    opener: `Hi, is this ${b.name}? This is ${me} from ${agency} — we build websites for local ${pb.label.toLowerCase()}s${b.city ? ` around ${b.city}` : ""}. Do you have 30 seconds? I noticed something about how ${b.name} shows up online.`,
    observations: observations.map((o) => `${o.observation.replace(/^I /, "I ")} — that could mean ${o.opportunity}.`),
    noAudit: !audit,
    questions: [
      `How do most new customers find you right now?`,
      `When someone wants to ${goal.includes("book") ? "book" : goal.includes("quote") ? "get a quote" : "get in touch"}, how do they usually do it?`,
      essentials.length ? `Would ${essentials.slice(0, 2).join(" or ").toLowerCase()} on your site save you time?` : `Is there anything customers keep asking you that a website could answer?`,
      ...(b.website ? [`Who looks after your current website — is it easy for you to update?`] : []),
    ],
    offer: `What we'd do: ${b.website ? "rebuild the site" : "build you a simple, fast site"} focused on ${goal}${essentials.length ? `, with ${essentials.join(", ").toLowerCase()}` : ""}. We price by what you actually need, not by page${company.pricingEnabled && company.pricingDetails.trim() ? " — I can tell you the exact price once I know what you need" : ""}.`,
    objections: [
      { q: "“We get enough business already.”", a: "Totally fair. A site mainly saves you time — fewer repeat questions by phone — and makes sure people who search for you find the right info." },
      { q: "“We just use Facebook / Google.”", a: "That works for people who already know you. A site of your own shows up for new searches and you control it — no algorithm changes." },
      { q: "“How much is it?”", a: company.pricingEnabled && company.pricingDetails.trim() ? "It depends on what you need — open the Quote section below to give an exact figure from your pricing." : "It depends on the features you need. Can I ask two quick questions and send you an exact quote?" },
      ...(hasCare ? [{ q: "“We don't have time to manage a website.”", a: "We can look after it monthly — updates, hosting and backups — so you never have to touch it." }] : []),
    ],
    close: company.meetingLink ? `Could I send you a quick mock-up idea, or would a 15-minute call work better? (Booking link: ${company.meetingLink})` : `Could I send you a quick mock-up idea by email? What's the best address for that?`,
    askForEmail: !b.email,
  };
}

const QuoteSchema = z.object({
  package_name: z.string().describe("The single package from PRICING that fits, exactly as written there"),
  price: z.string().describe("The exact price of that package as written in PRICING"),
  why: z.string().describe("One or two sentences: why this package fits this business's needs"),
  included: z.array(z.string()).describe("What they get, tied to their needs (max 8 short lines)"),
  add_ons: z.array(z.string()).describe("Optional extras from PRICING that fit, each with its exact price as written in PRICING (may be empty)"),
  care_plan: z.string().describe("A monthly care/management plan from PRICING with its exact price, if one exists and fits; else empty string"),
  terms: z.string().describe("Payment / timeline terms copied from PRICING, or empty string"),
  questions: z.array(z.string()).describe("Up to 3 questions to confirm requirements before final price"),
});

/** A requirements-based quote using only the agency's configured pricing; every figure is checked against it. */
export async function generateQuote(workspaceId: string, businessId: string, requirements: string) {
  const { business: b, audit, missing } = await leadWithAudit(workspaceId, businessId);
  const { company } = await getSettings(workspaceId);
  if (!company.pricingEnabled || !company.pricingDetails.trim()) throw new AppError("NOT_CONFIGURED", "Add your prices in Settings → Company → Pricing first, then quotes can be built from them.");
  const ai = await getAi(workspaceId);
  if (!ai) throw new AppError("NOT_CONFIGURED", "Connect Google Gemini (or Anthropic) in Settings → Integrations to build quotes.");
  const pb = getPlaybook(b.businessType);
  const observations = outreachObservations(b, audit).slice(0, 4);
  let q: z.infer<typeof QuoteSchema>;
  try {
    q = await ai.json({
      feature: "quote",
      system: `You prepare a short, honest website quote for a small web agency. Choose the ONE package from PRICING that covers what this business needs — price by requirements and features, never by number of pages. Use only packages, add-ons, care plans, prices and terms that appear in PRICING, copied exactly. Never invent prices, discounts, guarantees or deadlines. Prefer the cheapest package that meets the needs. Keep wording plain and specific to this business.`,
      prompt: `PRICING (the only allowed figures):\n${company.pricingDetails.trim()}\n\nAGENCY SERVICES: ${company.services.join(", ") || "(not listed)"}\n\nBUSINESS\nName: ${b.name}\nType: ${pb.label}${b.category ? ` (${b.category})` : ""}\nCity: ${b.city ?? "unknown"}\nMain goal of their site: ${pb.primaryConversion}\nCurrent website: ${b.website ? `${b.website} (${(b.websiteClass ?? b.websiteStatus).replace(/_/g, " ").toLowerCase()})` : "none"}\nVerified findings:\n${observations.map((o) => `- ${o.observation}`).join("\n") || "- (no audit yet)"}\nRecommended features they're missing: ${missing.map((f) => `${f.name} (${f.priority})`).join(", ") || "(none recorded)"}\n\nWHAT THE CLIENT SAID THEY NEED (may be empty):\n${requirements.trim() || "(nothing yet — base it on the findings and missing features)"}`,
      schema: QuoteSchema,
      maxTokens: 2000,
    });
  } catch (e) {
    throw new AppError("UPSTREAM_ERROR", `Couldn't build the quote: ${describeError(e)}`);
  }
  const text = [
    `Quote for ${b.name}`,
    ``,
    `${q.package_name} — ${q.price}`,
    q.why,
    ``,
    `What's included:`,
    ...q.included.slice(0, 8).map((i) => `• ${i}`),
    ...(q.add_ons.length ? [``, `Optional add-ons:`, ...q.add_ons.map((a) => `• ${a}`)] : []),
    ...(q.care_plan.trim() ? [``, `Ongoing care: ${q.care_plan.trim()}`] : []),
    ...(q.terms.trim() ? [``, q.terms.trim()] : []),
    ...(q.questions.length ? [``, `To confirm the final price:`, ...q.questions.slice(0, 3).map((x) => `• ${x}`)] : []),
  ].join("\n");
  // Every price in the quote must exist in the configured pricing.
  const issues = scanCommitments(text, company);
  return { text, issues, packageName: q.package_name, price: q.price };
}
