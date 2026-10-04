// Feature library used by the opportunity engine and prompt generator.
// `detect` patterns are evaluated against the audited website's text, link URLs,
// headings, and form field names to decide whether a feature already exists.
// A feature is only reported as "missing" when the site was actually analysed.

export type FeatureDef = {
  key: string;
  name: string;
  /** Default rationale; playbooks can override it with business-specific reasons. */
  why: string;
  detect: RegExp[];
  /** Implementation spec for the downstream website-building AI. */
  spec: string[];
  ownerInputs?: string[];
  events?: string[];
};

export const FEATURES: Record<string, FeatureDef> = {
  click_to_call: {
    key: "click_to_call",
    name: "Click-to-call phone CTA",
    why: "Mobile visitors with urgent intent want to call immediately.",
    detect: [/href="?tel:/i],
    spec: [
      "Render the verified phone number as an `<a href=\"tel:…\">` link in the header, hero, contact section and footer.",
      "On phones, show a sticky bottom action bar containing a Call button (min 48px tall) that never covers form inputs or the cookie banner.",
      "Track `phone_click` with the location of the button (header, hero, sticky_bar, footer).",
    ],
    events: ["phone_click"],
  },
  contact_form: {
    key: "contact_form",
    name: "Contact form",
    why: "Gives visitors who are not ready to call a low-friction way to reach the business.",
    detect: [/<form[^>]*>[\s\S]*?(message|comments|inquiry|enquiry)/i, /contact form/i, /formspree|wpcf7|gform|hsforms|jotform|typeform/i],
    spec: [
      "Fields: Name (required), Email (required, validated), Phone (optional, tel input), Message (required, 10–2000 chars).",
      "Server-side validation mirrors client validation; never trust the client.",
      "Spam protection: hidden honeypot field + time-to-submit check (reject < 3s) + server rate limit (5/hour/IP). Add a CAPTCHA only if spam persists.",
      "States: idle → submitting (button disabled, spinner, `aria-busy`) → success (inline confirmation that states when the business will respond: [VERIFY RESPONSE TIME]) → error (inline, preserves typed data, offers phone fallback).",
      "Deliver submissions to the business email configured via environment variable; never hard-code the address in client code.",
    ],
    events: ["contact_form_submitted"],
  },
  quote_request: {
    key: "quote_request",
    name: "Online quote / estimate request",
    why: "Service buyers compare providers; a structured quote request captures the lead while intent is high.",
    detect: [/(request|get|free|instant)\s+(a\s+)?(quote|estimate)/i, /quote request/i, /estimate request/i],
    spec: [
      "Multi-step form (2–3 short steps with a progress indicator) rather than one long form; each step validates before advancing.",
      "Step 1 — service details specific to this business (see Forms section). Step 2 — property/project details. Step 3 — contact details and preferred contact method.",
      "Allow optional photo upload (max 5 images, 10 MB each, image types only, scanned server-side) where photos help estimating.",
      "Success state sets expectations: “We'll review your request and respond within [BUSINESS TO CONFIRM RESPONSE TIME].” Never promise a price.",
    ],
    events: ["quote_started", "quote_step_completed", "quote_submitted"],
  },
  online_booking: {
    key: "online_booking",
    name: "Online booking / appointments",
    why: "Customers increasingly expect to book without a phone call, including outside business hours.",
    detect: [/book (now|online|an appointment|appointment)|schedule (an )?(appointment|service|visit)/i, /calendly|acuityscheduling|squareup\.com\/appointments|square\.site\/book|booksy|vagaro|fresha|setmore|janeapp|zocdoc|mindbody|simplybook|schedulicity|glossgenius|timely/i],
    spec: [
      "Integrate the booking platform the business already uses ([BUSINESS TO CONFIRM BOOKING PLATFORM]); if none, recommend one but implement via a configurable embed/link so it can be swapped.",
      "Booking CTA appears in header, hero, every service card, and the sticky mobile bar.",
      "If embedding, lazy-load the widget only when the booking section enters the viewport or the CTA is clicked to protect page speed.",
      "Provide a non-JavaScript fallback link and a phone fallback.",
    ],
    ownerInputs: ["Booking platform or availability rules", "Services that can be booked online and their durations"],
    events: ["booking_started", "booking_completed"],
  },
  reservations: {
    key: "reservations",
    name: "Table reservations",
    why: "Diners decide where to eat on their phones; a reservation path converts that intent before they choose elsewhere.",
    detect: [/reserv(e|ation)|book a table/i, /opentable|resy\.com|exploretock|sevenrooms|yelp\.com\/reservations/i],
    spec: [
      "Use the reservation provider the restaurant already uses ([BUSINESS TO CONFIRM — e.g. OpenTable, Resy, Tock]) via link or lazy-loaded widget; do not build a custom reservation backend unless requested.",
      "“Reserve a table” is the primary CTA in the header on desktop and the sticky bar on mobile when reservations are offered.",
      "If reservations are not offered, replace this CTA with the verified alternative (walk-in, call, order online) — do not imply reservations exist.",
    ],
    events: ["reservation_click"],
  },
  online_menu: {
    key: "online_menu",
    name: "Mobile-friendly HTML menu",
    why: "The menu is the most-visited page on most restaurant sites; PDF or image menus are slow and unreadable on phones.",
    detect: [/>\s*menu\s*</i, /\/menu/i, /our menu|view menu|food menu|drinks menu/i],
    spec: [
      "Real HTML menu (not PDF/image) with categories as anchored sections and a sticky horizontally-scrollable category nav on mobile.",
      "Each item: name, description, price, and dietary tags (V, VG, GF, contains nuts) — ONLY with verified data. Use [VERIFY PRICE] / [BUSINESS OWNER TO PROVIDE] placeholders otherwise.",
      "Menu content lives in a structured data file (JSON/CMS) so staff can update prices without touching layout code.",
      "Add an allergen disclaimer supplied by the business ([BUSINESS TO PROVIDE ALLERGEN STATEMENT]).",
    ],
    ownerInputs: ["Current menu with prices", "Dietary/allergen information"],
    events: ["menu_view", "menu_category_click"],
  },
  online_ordering: {
    key: "online_ordering",
    name: "Online ordering",
    why: "Takeout/delivery orders placed directly avoid third-party commissions and capture customers who are ready to buy.",
    detect: [/order (online|now|pickup|delivery)/i, /doordash|ubereats|skipthedishes|grubhub|toasttab|chownow|clover\.com|square\.site|olo\.com|menufy|gloriafood/i],
    spec: [
      "Link to or embed the ordering platform the business uses ([BUSINESS TO CONFIRM ORDERING PLATFORM]). Prefer first-party ordering if available.",
      "“Order online” CTA visible in hero and sticky mobile bar; show pickup/delivery availability only if verified.",
    ],
    events: ["order_online_click"],
  },
  gallery: {
    key: "gallery",
    name: "Photo gallery / portfolio",
    why: "Visual proof of real work or atmosphere is one of the strongest persuasion tools for this type of business.",
    detect: [/gallery|portfolio|our work|recent (work|projects)|projects/i],
    spec: [
      "Responsive grid (1 col phone, 2 tablet, 3–4 desktop) with lazy-loaded, AVIF/WebP images with explicit width/height to prevent layout shift.",
      "Accessible lightbox: focus trap, Esc to close, arrow-key navigation, visible close button, descriptive alt text per image.",
      "Use ONLY real photos supplied by the business. Use clearly labelled placeholders `[ADD REAL PHOTO: description]` — never stock images presented as the business's work.",
    ],
    ownerInputs: ["Real photos (with permission to publish)"],
    events: ["gallery_open"],
  },
  before_after: {
    key: "before_after",
    name: "Before/after showcase",
    why: "Transformation-based services sell on visible results.",
    detect: [/before\s*(&|and|\/)\s*after/i],
    spec: [
      "Accessible comparison slider (keyboard operable range input, labelled “Before” and “After”) with a static side-by-side fallback on reduced-motion or no-JS.",
      "Only real project photos with the client's permission; caption with project type and area served if verified.",
    ],
    ownerInputs: ["Before/after photo pairs"],
  },
  reviews: {
    key: "reviews",
    name: "Real reviews / testimonials",
    why: "Social proof reduces risk for first-time customers.",
    detect: [/testimonial|reviews?|what (our )?(clients|customers|patients) say|★|5 stars/i],
    spec: [
      "Display only genuine reviews supplied by the business or embedded from a review platform with attribution and a link to the source.",
      "NEVER write, paraphrase into new claims, or invent testimonials. Use `[ADD REAL TESTIMONIAL]` placeholders.",
      "Do not display an aggregate rating in structured data unless the reviews are first-party and comply with search engine guidelines.",
    ],
    ownerInputs: ["Testimonials with permission", "Links to review profiles"],
  },
  service_pages: {
    key: "service_pages",
    name: "Dedicated service pages",
    why: "Individual pages per service answer specific questions and rank for specific searches.",
    detect: [/\/services?\//i, /our services/i],
    spec: [
      "One page per verified service with: what it includes, who it is for, process steps, FAQs, related services, and a service-specific CTA.",
      "Unique title tag, meta description and H1 per page; internal links from the homepage service cards.",
      "Service list must come from verified information; unverified services are marked `[CONFIRM SERVICE OFFERED]`.",
    ],
  },
  service_areas: {
    key: "service_areas",
    name: "Service area information",
    why: "Local customers need to confirm the business serves their area before contacting it.",
    detect: [/service areas?|areas (we )?serve|we serve|serving (the )?/i],
    spec: [
      "Service Areas section/page listing confirmed areas ([BUSINESS TO CONFIRM SERVICE AREAS]) with optional static map image (not an interactive map on initial load).",
      "Do not create thin duplicate “city pages”; only create a location page when there is genuinely distinct content for that area.",
    ],
    ownerInputs: ["List of cities/neighbourhoods served"],
  },
  hours_location: {
    key: "hours_location",
    name: "Hours, location & directions",
    why: "“Are they open now and how do I get there?” is a top question for walk-in businesses.",
    detect: [/hours|open (daily|monday|mon)|mon(day)?\s*[-–:]/i, /google\.com\/maps|maps\.google|get directions/i],
    spec: [
      "Hours table using verified hours only (`[VERIFY HOURS]` otherwise), with holiday-hours note.",
      "Address with a “Get directions” link to Google Maps; lazy-load any embedded map behind a click or viewport trigger.",
      "Optionally show an “Open now / Closed” indicator computed client-side from the verified hours and the business's time zone.",
    ],
  },
  faq: {
    key: "faq",
    name: "FAQ section",
    why: "Answers common objections before the visitor has to ask, and supports search visibility.",
    detect: [/faq|frequently asked/i],
    spec: [
      "Accessible accordion (`<details>/<summary>` or button with `aria-expanded`), all answers present in the HTML for crawlers.",
      "Questions are drafted from the topics listed below; ANSWERS must be supplied/approved by the business — use `[BUSINESS TO ANSWER]` where unknown.",
    ],
  },
  pricing: {
    key: "pricing",
    name: "Pricing / packages transparency",
    why: "Even starting-from pricing or what affects price filters out poor-fit leads and builds trust.",
    detect: [/pricing|price list|prices|packages|rates|starting (at|from)|\$\s?\d/i],
    spec: [
      "Pricing section or page ONLY with verified prices; otherwise explain what affects price and use `[BUSINESS TO PROVIDE PRICING]`.",
      "Never invent prices, discounts, or “free” offers.",
    ],
    ownerInputs: ["Prices or price ranges, if they want them published"],
  },
  team: {
    key: "team",
    name: "Team / staff profiles",
    why: "People choose a provider they can trust; real faces and credentials humanise the business.",
    detect: [/our team|meet (the|our)|staff|stylists|barbers|dentists|doctors|attorneys|lawyers/i],
    spec: [
      "Profile cards with real photo, name, role and (verified) credentials; placeholders `[BUSINESS OWNER TO PROVIDE TEAM INFO]` otherwise.",
      "Never invent names, years of experience, or qualifications.",
    ],
    ownerInputs: ["Team names, roles, photos, verified credentials"],
  },
  emergency_cta: {
    key: "emergency_cta",
    name: "Emergency service call-out",
    why: "Urgent problems (leaks, outages, no heat) are high-value jobs that go to whoever answers first.",
    detect: [/24\/7|24 hours|emergency/i],
    spec: [
      "If (and only if) the business confirms emergency service, show a prominent emergency banner with click-to-call. Otherwise omit — do not imply 24/7 availability.",
    ],
    ownerInputs: ["Whether emergency/after-hours service is offered"],
  },
  financing: {
    key: "financing",
    name: "Financing information",
    why: "Large-ticket projects convert better when payment options are clear.",
    detect: [/financing|payment plans?|monthly payments/i],
    spec: ["Only include if the business confirms financing partners; link to the provider's official terms. Never state rates or approval odds."],
    ownerInputs: ["Financing partner and approved wording"],
  },
  credentials: {
    key: "credentials",
    name: "Licensing, insurance & credentials",
    why: "For trades and regulated professions, proof of licensing and insurance is a key trust factor.",
    detect: [/licen[cs]ed|insured|bonded|certified|accredited|member of/i],
    spec: [
      "Credentials strip/section listing ONLY verified licences, insurance, associations and certifications with numbers where the business provides them.",
      "Use `[VERIFY LICENCE NUMBER]` style placeholders; never invent certifications or awards.",
    ],
    ownerInputs: ["Licence numbers, insurance, association memberships"],
  },
  lead_magnet: {
    key: "lead_magnet",
    name: "Newsletter / offers signup",
    why: "Captures repeat-customer interest from visitors who are not buying today.",
    detect: [/newsletter|subscribe|sign up for|mailchimp|klaviyo/i],
    spec: [
      "Single email field with explicit consent checkbox text supplied by the business; double opt-in through the business's email platform.",
      "Never pre-check consent boxes.",
    ],
  },
  gift_cards: {
    key: "gift_cards",
    name: "Gift cards",
    why: "Gift cards create revenue and new-customer referrals, especially around holidays.",
    detect: [/gift ?cards?|gift certificates?/i],
    spec: ["Link to the business's gift-card provider if one exists ([CONFIRM GIFT CARD PROVIDER]); omit otherwise."],
  },
  catering_events: {
    key: "catering_events",
    name: "Catering / private events enquiry",
    why: "Catering and private events are high-value orders that need a structured enquiry.",
    detect: [/catering|private (events?|dining|parties)|group bookings?/i],
    spec: [
      "Enquiry form: event date, guest count, event type, service style (pickup/delivery/on-site — only verified options), budget range (optional), contact details, notes.",
    ],
  },
  class_schedule: {
    key: "class_schedule",
    name: "Class schedule & memberships",
    why: "Prospective members want to see classes, times and how to start before visiting.",
    detect: [/class schedule|timetable|classes|membership|join now|free trial/i, /mindbody|glofox|wodify|pushpress/i],
    spec: [
      "Filterable weekly schedule (by day/class type) fed from the gym's scheduling platform or a data file; real times only.",
      "Membership options only with verified pricing; otherwise “Contact us for membership options”.",
      "Trial/intro offer CTA only if the business confirms the offer.",
    ],
  },
  listings: {
    key: "listings",
    name: "Property listings / search",
    why: "Buyers and sellers expect to browse current listings and see recent results.",
    detect: [/listings?|mls|idx|homes for sale|featured properties/i],
    spec: [
      "Integrate the agent's licensed IDX/listing feed provider ([CONFIRM IDX PROVIDER]); do not scrape listing portals.",
      "Seller lead path: “What's my home worth?” request form (address, property type, timeline, contact) — no automated valuation figures unless provided by a licensed tool.",
    ],
  },
  patient_info: {
    key: "patient_info",
    name: "New patient information & forms",
    why: "New patients need to know insurance, what to expect, and how to complete forms before visiting.",
    detect: [/new patients?|patient forms|intake forms?|insurance (we accept|accepted)/i],
    spec: [
      "New Patients page: what to expect, accepted insurance ([VERIFY INSURANCE PLANS]), forms download/online link via a HIPAA/PHIPA-compliant provider.",
      "NEVER collect medical information through the generic website contact form; route it to the practice's compliant patient portal.",
    ],
  },
  case_consultation: {
    key: "case_consultation",
    name: "Consultation request",
    why: "Professional services sell through a first conversation; a clear consultation path is the main conversion.",
    detect: [/consultation|book a call|schedule a call|free consult/i],
    spec: [
      "Consultation request form: name, email, phone, matter/service type (select from verified practice areas), short description, preferred contact time.",
      "Include a confidentiality notice approved by the business (e.g. submitting the form does not create a client relationship — [BUSINESS/LEGAL TO APPROVE WORDING]).",
    ],
  },
  live_chat: {
    key: "live_chat",
    name: "Live chat / messaging",
    why: "Some visitors prefer messaging over calls or forms.",
    detect: [/intercom|tawk\.to|drift\.com|livechat|crisp\.chat|tidio|wa\.me|whatsapp/i],
    spec: ["Optional. If added, load the chat script only after user interaction or idle time to protect performance."],
  },
  blog: {
    key: "blog",
    name: "Helpful articles / blog",
    why: "Useful local content answers questions customers search for.",
    detect: [/\/blog|\/news|articles|tips/i],
    spec: ["Optional, lower priority. Only recommend if the business can maintain it; no AI-generated filler content."],
  },
  rooms_booking: {
    key: "rooms_booking",
    name: "Room availability & direct booking",
    why: "Direct bookings avoid OTA commissions and let the property own the guest relationship.",
    detect: [/book (your )?(stay|room)|check availability|check-in|cloudbeds|siteminder|booking engine/i],
    spec: ["Integrate the property's booking engine ([CONFIRM BOOKING ENGINE]); show room types with real photos and amenities only."],
  },
  enrollment: {
    key: "enrollment",
    name: "Enrolment / tour request",
    why: "Parents and students need a clear next step: book a tour, register interest, or join a waitlist.",
    detect: [/enrol|enroll|registration|book a tour|waitlist|admissions/i],
    spec: [
      "Tour/enrolment enquiry form: parent/guardian name, email, phone, child's age group or program (verified programs only), desired start date, questions.",
      "Do not collect sensitive child information through the website; collect it later through the provider's secure registration process.",
    ],
  },
  portfolio_packages: {
    key: "portfolio_packages",
    name: "Portfolio + package enquiry",
    why: "Creative clients buy based on style; portfolio plus clear packages shortens the decision.",
    detect: [/portfolio|packages|sessions|collections/i],
    spec: ["Portfolio organised by session/project type; enquiry form with date, type, location, budget range (optional), details."],
  },
};

export type FeatureRef = { key: string; priority: "essential" | "recommended" | "optional"; why?: string };
