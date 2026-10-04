import type { Business, WebsiteAudit, WebsiteFinding } from "@prisma/client";
import { FEATURES } from "../intel/features";
import { getPlaybook } from "../intel/playbooks";

export type Observation = { code: string; observation: string; opportunity: string; weight: number };

/**
 * Turns VERIFIED audit findings into plain-language observations suitable for
 * outreach. Only things that were actually detected are returned — never
 * generic “your website could be better” filler.
 */
export function outreachObservations(business: Business, audit: (WebsiteAudit & { findings: WebsiteFinding[] }) | null): Observation[] {
  const pb = getPlaybook(business.businessType);
  const conv = pb.primaryConversion.toLowerCase();
  const out: Observation[] = [];
  const name = business.name;
  if (!audit) return out;
  const has = (code: string) => audit.findings.find((f) => f.code === code);
  const ex = (audit.extracted ?? {}) as { singlePage?: boolean; copyrightYear?: number | null; pagesAnalysed?: unknown[] };

  if (has("site.none")) out.push({ code: "site.none", weight: 100, observation: `I couldn't find a website for ${name} — searching mostly turns up the map listing`, opportunity: `a simple site of your own where people can see what you offer and ${conv.includes("quote") ? "request a quote" : conv.includes("book") ? "book" : "get in touch"} directly` });
  const social = has("site.social_only");
  if (social) out.push({ code: "site.social_only", weight: 95, observation: `the website link on ${name}'s listing points to a social media page rather than a site you control`, opportunity: `a dedicated site that gives visitors a clear way to ${conv.includes("quote") ? "request a quote" : "contact you"} without depending on a social platform` });
  const unavailable = has("site.unavailable");
  if (unavailable) out.push({ code: "site.unavailable", weight: 98, observation: `the website linked from ${name}'s listing didn't load when I checked it`, opportunity: "getting a reliable site back online so visitors from search don't hit an error page" });
  if (audit.classification === "INCOMPLETE") out.push({ code: "site.incomplete", weight: 90, observation: "the current site looks unfinished (placeholder or very little content)", opportunity: "a complete site that answers the questions customers ask before they call" });

  for (const f of audit.findings.filter((x) => x.code.startsWith("feature.missing.") && x.severity === "HIGH")) {
    const key = f.code.replace("feature.missing.", "");
    const def = FEATURES[key];
    if (!def) continue;
    out.push({ code: f.code, weight: 80 - pb.features.findIndex((x) => x.key === key), observation: `I didn't see a way to ${featureVerb(key)} on the site`, opportunity: OPPORTUNITY_PHRASES[key] ?? `adding ${def.name.toLowerCase()}` });
  }
  if (has("mobile.viewport")?.severity && has("mobile.viewport")!.severity !== "POSITIVE") out.push({ code: "mobile.viewport", weight: 75, observation: "the site doesn't appear to be set up for phones — it loads as a zoomed-out desktop page on mobile", opportunity: "a mobile-first layout, which matters because most local searches happen on phones" });
  if (has("trust.no_https")) out.push({ code: "trust.no_https", weight: 70, observation: "the site isn't served over HTTPS, so browsers label it “Not secure”", opportunity: "moving to HTTPS, which removes that warning and protects form submissions" });
  if (has("conv.form") && has("conv.form")!.severity !== "POSITIVE") out.push({ code: "conv.form", weight: 65, observation: "I couldn't find a form to send an enquiry — the main option seems to be calling", opportunity: "a short enquiry form for people who aren't ready to call" });
  if (ex.singlePage) out.push({ code: "site.single_page", weight: 55, observation: "your current site is primarily a single scrolling page", opportunity: "dedicated pages for each main service so people (and search engines) find specific answers" });
  if (audit.classification === "OUTDATED" && ex.copyrightYear) out.push({ code: "site.outdated", weight: 60, observation: `the site footer still shows © ${ex.copyrightYear}, and a few parts of the build look dated`, opportunity: "a refreshed, faster site that reflects the business today" });
  if (has("seo.local_terms")?.severity && has("seo.local_terms")!.severity !== "POSITIVE" && business.city) out.push({ code: "seo.local_terms", weight: 40, observation: `the homepage title and heading don't mention ${business.city}`, opportunity: `clearer local signals so people searching in ${business.city} are more likely to find you` });
  if (has("perf.ttfb")?.severity === "HIGH") out.push({ code: "perf.ttfb", weight: 45, observation: "the homepage took a while to load when I tested it", opportunity: "a faster site, which helps both visitors and search rankings" });
  const seen = new Set<string>();
  return out.sort((a, b) => b.weight - a.weight).filter((o) => (seen.has(o.observation) ? false : (seen.add(o.observation), true)));
}

function featureVerb(key: string) {
  return (
    {
      quote_request: "request a quote online",
      online_booking: "book an appointment online",
      reservations: "reserve a table online",
      online_menu: "view the menu as a regular web page",
      online_ordering: "order online directly",
      click_to_call: "tap to call from a phone",
      contact_form: "send a message through the site",
      service_areas: "check which areas you serve",
      reviews: "read customer reviews",
      gallery: "see photos of your work",
      before_after: "see before-and-after examples",
      hours_location: "find your hours and directions",
      patient_info: "find new-patient information",
      case_consultation: "request a consultation",
      enrollment: "book a tour or enquire about enrolment",
      class_schedule: "see the class schedule",
      listings: "browse listings",
      rooms_booking: "book a room directly",
      service_pages: "read about each service on its own page",
      team: "learn about the team",
      pricing: "see pricing or what affects price",
      credentials: "see licensing or insurance details",
    }[key] ?? `find ${FEATURES[key]?.name.toLowerCase() ?? key}`
  );
}

const OPPORTUNITY_PHRASES: Record<string, string> = {
  quote_request: "a short online quote request (service, property details, preferred date) so people can ask for a price without having to call",
  online_booking: "online booking, so customers can pick a time even outside business hours",
  reservations: "a clear “Reserve a table” button linked to a reservation system",
  online_menu: "a fast, phone-friendly HTML menu instead of a PDF or image",
  online_ordering: "a direct “Order online” option for pickup or delivery",
  click_to_call: "a tap-to-call button, since most local visitors browse on their phones",
  contact_form: "a simple contact form for visitors who aren't ready to call",
  service_areas: "a clear list of the areas you serve",
  reviews: "a section showcasing real customer reviews",
  gallery: "a gallery of real photos of your work",
  before_after: "before-and-after photos of real jobs",
  hours_location: "clear hours, address and a directions link",
  patient_info: "a new-patient page explaining what to expect and how to book",
  case_consultation: "a simple, confidential consultation request form",
  enrollment: "an easy way for parents to book a tour",
  class_schedule: "an up-to-date class schedule with a booking link",
  listings: "a current listings section",
  rooms_booking: "direct room booking on your own site",
  service_pages: "a dedicated page for each main service",
  credentials: "a short section showing your licensing and insurance",
};
