// Shared (client + server) display metadata. Keep in sync with prisma enums.

export const LEAD_STATUSES = [
  "NEW",
  "RESEARCHED",
  "HIGH_OPPORTUNITY",
  "CONTACTED",
  "RESPONDED",
  "AI_RESPONSE_READY",
  "INTERESTED",
  "FOLLOW_UP",
  "MEETING",
  "PROPOSAL",
  "WON",
  "LOST",
  "DO_NOT_CONTACT",
] as const;
export type LeadStatusT = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_META: Record<LeadStatusT, { label: string; tone: Tone }> = {
  NEW: { label: "New", tone: "slate" },
  RESEARCHED: { label: "Researched", tone: "blue" },
  HIGH_OPPORTUNITY: { label: "High opportunity", tone: "violet" },
  CONTACTED: { label: "Contacted", tone: "sky" },
  RESPONDED: { label: "Responded", tone: "amber" },
  AI_RESPONSE_READY: { label: "AI response ready", tone: "indigo" },
  INTERESTED: { label: "Interested", tone: "emerald" },
  FOLLOW_UP: { label: "Follow-up", tone: "orange" },
  MEETING: { label: "Meeting", tone: "teal" },
  PROPOSAL: { label: "Proposal", tone: "cyan" },
  WON: { label: "Won", tone: "green" },
  LOST: { label: "Lost", tone: "zinc" },
  DO_NOT_CONTACT: { label: "Do not contact", tone: "red" },
};

export type Tone =
  | "slate" | "blue" | "violet" | "sky" | "amber" | "indigo" | "emerald" | "orange"
  | "teal" | "cyan" | "green" | "zinc" | "red" | "rose" | "yellow";

export const WEBSITE_STATUS_META: Record<string, { label: string; tone: Tone }> = {
  UNKNOWN: { label: "Not checked", tone: "zinc" },
  NO_WEBSITE: { label: "No website", tone: "violet" },
  WEBSITE_FOUND: { label: "Website found", tone: "blue" },
  WEBSITE_UNAVAILABLE: { label: "Unavailable", tone: "red" },
  WEBSITE_BLOCKED: { label: "Blocked", tone: "orange" },
  MANUAL_REVIEW: { label: "Manual review", tone: "amber" },
};

export const WEBSITE_CLASS_META: Record<string, { label: string; tone: Tone; description: string }> = {
  NO_WEBSITE: { label: "No website", tone: "violet", description: "No website was listed or discovered." },
  OUTDATED: { label: "Outdated", tone: "orange", description: "Multiple signals of an older build (layout, mobile support, security, or stale content)." },
  SINGLE_PAGE: { label: "Single-page", tone: "sky", description: "Most or all content lives on one scrolling page." },
  BROKEN: { label: "Broken", tone: "red", description: "The site could not be loaded or returned server errors." },
  INCOMPLETE: { label: "Incomplete", tone: "amber", description: "Placeholder, parked, or very thin content." },
  BASIC: { label: "Basic", tone: "slate", description: "Functional but missing several conversion or content fundamentals." },
  MODERN: { label: "Modern", tone: "blue", description: "Modern build with some gaps." },
  STRONG: { label: "Strong", tone: "emerald", description: "Well-built with only minor gaps." },
  EXCELLENT: { label: "Excellent", tone: "green", description: "High-quality site; limited improvement opportunity." },
  MANUAL_REVIEW: { label: "Manual review", tone: "amber", description: "Automated analysis was not permitted or was inconclusive." },
};

export const INTENT_META: Record<string, { label: string; tone: Tone }> = {
  INTERESTED: { label: "Interested", tone: "emerald" },
  QUESTION: { label: "Question", tone: "blue" },
  PRICING: { label: "Pricing", tone: "violet" },
  REQUEST_FOR_MEETING: { label: "Meeting request", tone: "teal" },
  REQUEST_FOR_PHONE_CALL: { label: "Call request", tone: "cyan" },
  NOT_INTERESTED: { label: "Not interested", tone: "zinc" },
  UNSUBSCRIBE: { label: "Unsubscribe", tone: "red" },
  CONFUSED: { label: "Confused", tone: "amber" },
  COMPLAINT: { label: "Complaint", tone: "rose" },
  LEGAL: { label: "Legal", tone: "red" },
  PAYMENT: { label: "Payment", tone: "orange" },
  SPAM: { label: "Spam", tone: "zinc" },
  AUTO_REPLY: { label: "Auto-reply", tone: "slate" },
  OTHER: { label: "Other", tone: "slate" },
};

export const SCORE_CATEGORIES = [
  "design",
  "performance",
  "mobile",
  "content",
  "conversion",
  "seo",
  "trust",
  "functionality",
] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export const SCORE_CATEGORY_LABEL: Record<ScoreCategory, string> = {
  design: "Design",
  performance: "Performance",
  mobile: "Mobile",
  content: "Content",
  conversion: "Conversion",
  seo: "SEO",
  trust: "Trust",
  functionality: "Functionality",
};

export const RESPONSE_TONES = ["Professional", "Friendly", "Concise", "Consultative", "Premium", "Casual"] as const;

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster, lower cost)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest, lowest cost)" },
] as const;

export const TEMPLATE_VARIABLES = [
  "business_name",
  "contact_name",
  "website",
  "city",
  "category",
  "website_score",
  "opportunity_score",
  "top_issue",
  "top_opportunity",
  "sender_name",
  "company_name",
  "meeting_link",
] as const;

export const INBOX_SECTIONS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "new", label: "New responses" },
  { id: "draft", label: "AI draft ready" },
  { id: "interested", label: "Interested" },
  { id: "followup", label: "Follow-up" },
  { id: "review", label: "Needs human review" },
  { id: "hot", label: "Hot leads" },
  { id: "closed", label: "Closed" },
] as const;
export type InboxSection = (typeof INBOX_SECTIONS)[number]["id"];
