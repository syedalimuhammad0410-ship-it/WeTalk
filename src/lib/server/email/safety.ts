import type { CompanyProfile } from "@prisma/client";

/**
 * Checks AI-written emails for commitments the workspace has not configured:
 * prices, discounts, guarantees, deadlines, meeting slots, contract terms.
 * Returns human-readable issues; an empty array means no problems found.
 */
export function scanCommitments(text: string, company: Pick<CompanyProfile, "pricingEnabled" | "pricingDetails" | "meetingLink" | "permittedClaims" | "services">) {
  const issues: string[] = [];
  const allowed = `${company.pricingEnabled ? company.pricingDetails : ""}\n${company.permittedClaims}\n${company.services.join("\n")}`.toLowerCase();
  const money = text.match(/(?:[$€£]\s?\d[\d,]*(?:\.\d+)?k?)|(?:\b\d[\d,]*\s?(?:dollars|usd|cad|eur|gbp)\b)/gi) ?? [];
  for (const m of money) if (!allowed.includes(m.toLowerCase().replace(/\s/g, "")) && !allowed.includes(m.toLowerCase())) issues.push(`Mentions a price (“${m}”) that is not in your configured pricing.`);
  if (/\b\d{1,3}\s?%\s?(off|discount)|\bdiscount|\bfree of charge|\bno charge\b/i.test(text) && !/discount|free/i.test(allowed)) issues.push("Offers a discount or free work that has not been configured.");
  if (/\bguarantee[ds]?\b|\bwarrant(y|ies)\b|\bpromise\b|\b100%\b/i.test(text) && !/guarantee|warrant/i.test(allowed)) issues.push("Makes a guarantee/warranty/promise that has not been configured.");
  if (/\b(contract|terms and conditions|deposit|invoice|retainer)\b/i.test(text) && !/contract|deposit|retainer/i.test(allowed)) issues.push("Mentions contract/payment terms that have not been configured.");
  if (/\b(within|in)\s+\d+\s+(business\s+)?(days?|weeks?|hours?)\b|\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b/i.test(text) && !/within \d+|turnaround|timeline/i.test(allowed)) issues.push("Commits to a deadline or turnaround that has not been configured.");
  if (/\b(\d{1,2}(:\d{2})?\s?(am|pm))\b/i.test(text) && !company.meetingLink) issues.push("Proposes a specific meeting time, but no availability/meeting link is configured.");
  return Array.from(new Set(issues));
}
