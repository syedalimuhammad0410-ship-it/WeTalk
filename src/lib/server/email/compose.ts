import "../guard";
import * as z from "zod";
import type { Business } from "@prisma/client";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity } from "../activity";
import { getAi } from "../ai/client";
import { getPlaybook } from "../intel/playbooks";
import { getSettings } from "../workspace";
import { outreachObservations, type Observation } from "./observations";
import { scanCommitments } from "./safety";
import { renderTemplate, type TemplateVars } from "./templates";

export async function templateVarsFor(workspaceId: string, business: Business): Promise<{ vars: TemplateVars; observations: Observation[] }> {
  const [audit, contact, settings] = await Promise.all([
    db.websiteAudit.findFirst({ where: { businessId: business.id, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, include: { findings: true } }),
    db.contact.findFirst({ where: { businessId: business.id, isPrimary: true, name: { not: null } } }),
    getSettings(workspaceId),
  ]);
  const observations = outreachObservations(business, audit);
  const top = observations[0];
  return {
    observations,
    vars: {
      business_name: business.name,
      contact_name: contact?.name?.split(" ")[0] ?? "there",
      website: business.website ?? "",
      city: business.city ?? "",
      category: business.category ?? getPlaybook(business.businessType).label,
      website_score: business.websiteScore != null ? String(business.websiteScore) : "",
      opportunity_score: business.opportunityScore != null ? String(business.opportunityScore) : "",
      top_issue: top?.observation ?? "",
      top_opportunity: top?.opportunity ?? "",
      sender_name: settings.company.senderName || "",
      company_name: settings.company.companyName || "",
      meeting_link: settings.company.meetingLink || "",
    },
  };
}

const OutreachSchema = z.object({ subject: z.string(), body: z.string() });

/**
 * Generates a personalised outreach draft (saved as a DRAFT message).
 * Uses Claude when configured; otherwise renders the chosen template with
 * verified observations. Never sends anything.
 */
export async function generateOutreachDraft(workspaceId: string, businessId: string, userId: string | null, opts: { templateId?: string | null; campaignId?: string | null } = {}) {
  const business = await db.business.findFirst({ where: { id: businessId, workspaceId } });
  if (!business) throw new AppError("NOT_FOUND", "Lead not found.");
  if (business.doNotContact) throw new AppError("SUPPRESSED", `${business.name} is marked Do Not Contact. Outreach is blocked.`);
  const { vars, observations } = await templateVarsFor(workspaceId, business);
  const settings = await getSettings(workspaceId);
  const notes: string[] = [];
  if (!observations.length) notes.push("No audit observations available — run a website audit first for a more personal email.");

  let subject = "";
  let body = "";
  let aiGenerated = false;
  const ai = settings.automation.aiOutreachGeneration ? await getAi(workspaceId) : null;
  if (ai && observations.length) {
    const c = settings.company;
    try {
      const draft = await ai.json({
        feature: "outreach_generation",
        system: `You are an experienced local-business web consultant writing a first-contact email on behalf of a small web agency. The goal is a reply, not a sale: start a conversation with the owner.

WHAT GOOD LOOKS LIKE
- Subject: 3–7 words, specific to this business, lowercase-friendly, no clickbait, no ALL CAPS, no "!" or emojis. Good: "quick note about ${business.name}'s website", "${business.name} — online booking?". Bad: "Grow your business 10x!!!".
- First line: one specific, verified observation about THEIR online presence (from VERIFIED OBSERVATIONS) — never a generic compliment or "I hope this finds you well".
- Middle: why that matters for a ${getPlaybook(business.businessType).label.toLowerCase()} specifically (in plain words: lost calls, bookings, quote requests, trust), then 1–2 concrete improvements you would make. Speak like a person, not a brochure.
- Pricing: ${c.pricingEnabled && c.pricingDetails.trim() ? "you MAY add one short sentence pointing to the single best-fitting package from PRICING, using its exact \"starting from\" figure (e.g. \"sites like this start at $X\"). Never list several prices, never compute totals, never discount. If no package clearly fits, leave pricing out." : "no pricing is configured — do not mention any price or cost."}
- If the business already has a working site, you may briefly mention that the agency can also look after it monthly (updates, hosting, backups) ONLY if a management/care plan appears in SERVICES or PRICING.
- Close with ONE easy, low-pressure question they can answer in a few words (e.g. "Would it be useful if I sent over a quick mock-up idea?"). ${c.meetingLink ? "You may offer the meeting link as an alternative." : "Do not propose meeting times."}
- Sign off with the sender's first name and the agency name.

HARD RULES
- Use ONLY the verified observations and agency facts provided. No invented compliments, statistics, results, client names, guarantees, deadlines, discounts or "free" offers.
- Only mention services the agency lists. Never claim to be a customer or imply a prior relationship.
- Avoid spam-trigger wording ("act now", "limited time", "guaranteed", "100%", "risk-free", "no obligation", "dear sir/madam").
- Tone: ${settings.automation.responseTone}. Body length: 80–140 words. Plain text, short paragraphs (1–3 sentences), no markdown, no bullet lists.
- Do not include an unsubscribe line or a signature block (added automatically).`,
        prompt: `AGENCY\nName: ${c.companyName || "[agency]"}\nSender: ${c.senderName || "[sender]"}\nWhat we offer: ${c.description || "(not described)"}\nServices: ${c.services.join(", ") || "(not listed)"}\nService area: ${c.serviceAreas || "(not specified)"}\nBrand voice: ${c.brandVoice || "(not specified)"}\nPermitted claims: ${c.permittedClaims || "(none)"}\n${c.pricingEnabled && c.pricingDetails.trim() ? `PRICING (exact figures — quote only these):\n${c.pricingDetails.trim()}` : "PRICING: not configured"}\n${c.meetingLink ? `Meeting link (may include): ${c.meetingLink}` : "No meeting link configured — do not propose specific times."}\n\nBUSINESS\nName: ${business.name}\nType: ${getPlaybook(business.businessType).label}\nCity: ${business.city ?? "unknown"}\nMain goal of a site like theirs: ${getPlaybook(business.businessType).primaryConversion}\nCurrent website: ${business.website ? `${business.website} (status: ${business.websiteStatus.replace(/_/g, " ").toLowerCase()}${business.websiteClass ? `, assessed as ${business.websiteClass.replace(/_/g, " ").toLowerCase()}` : ""})` : "none found"}\nContact first name: ${vars.contact_name}\n\nVERIFIED OBSERVATIONS (most important first):\n${observations.slice(0, 3).map((o, i) => `${i + 1}. Observation: ${o.observation}. Opportunity: ${o.opportunity}.`).join("\n")}`,
        schema: OutreachSchema,
        maxTokens: 2000,
      });
      const issues = scanCommitments(`${draft.subject}\n${draft.body}`, c);
      if (issues.length) notes.push(`AI draft discarded (${issues.join(" ")}); used template instead.`);
      else {
        subject = draft.subject.trim();
        body = draft.body.trim();
        aiGenerated = true;
      }
    } catch (e) {
      notes.push(`AI outreach unavailable: ${describeError(e)}. Used template instead.`);
    }
  } else if (!ai && settings.automation.aiOutreachGeneration) {
    notes.push("Connect Anthropic or Gemini to enable AI-written outreach; using your template.");
  }

  if (!aiGenerated) {
    const template = opts.templateId
      ? await db.emailTemplate.findFirst({ where: { id: opts.templateId, workspaceId } })
      : await db.emailTemplate.findFirst({ where: { workspaceId, kind: "OUTREACH" }, orderBy: { createdAt: "asc" } });
    if (!template) throw new AppError("NOT_FOUND", "No outreach template found. Create one in Templates.");
    const s = renderTemplate(template.subject, vars);
    const b = renderTemplate(template.body, vars);
    subject = s.text;
    body = b.text;
    const missing = Array.from(new Set([...s.missing, ...b.missing]));
    if (missing.length) notes.push(`Fill in before sending: ${missing.map((m) => `{{${m}}}`).join(", ")}.`);
  }

  // One working draft per lead: replace the previous unsent draft.
  const existing = await db.emailMessage.findFirst({ where: { workspaceId, businessId, status: "DRAFT", kind: "OUTREACH" } });
  const to = business.email ?? "";
  const data = { subject, bodyText: body, toAddress: to, aiGenerated, campaignId: opts.campaignId ?? existing?.campaignId ?? null, analysis: { notes, observations: observations.slice(0, 3).map((o) => o.code) } };
  const draft = existing
    ? await db.emailMessage.update({ where: { id: existing.id }, data })
    : await db.emailMessage.create({ data: { workspaceId, businessId, direction: "OUTBOUND", status: "DRAFT", kind: "OUTREACH", fromAddress: "", ...data } });
  await logActivity({ workspaceId, userId, businessId, action: "email.generated", summary: `Outreach email ${aiGenerated ? "generated with AI" : "generated from template"}` });
  return { draft, notes, missingRecipient: !to };
}
