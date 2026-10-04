import "../guard";
import * as cheerio from "cheerio";

export type FormInfo = { action: string | null; method: string; fields: { name: string; type: string; label: string | null }[]; hasSubmit: boolean; purpose: string };
export type PageData = {
  url: string;
  status: number;
  ms: number;
  bytes: number;
  compressed: boolean;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  lang: string | null;
  viewport: string | null;
  canonical: string | null;
  og: { title: string | null; description: string | null; image: string | null };
  favicon: boolean;
  generator: string | null;
  platform: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  text: string;
  internalLinks: { href: string; text: string }[];
  externalLinks: string[];
  navLinkCount: number;
  telLinks: string[];
  mailtoEmails: string[];
  textEmails: string[];
  socialLinks: Record<string, string>;
  images: { total: number; missingAlt: number; lazy: number; withDims: number; legacyFormat: number; modernFormat: number };
  scripts: { total: number; external: number; jqueryVersion: string | null };
  stylesheets: number;
  inlineStyleAttrs: number;
  hasMediaQueries: boolean;
  usesWebFonts: boolean;
  deprecatedTags: number;
  layoutTables: number;
  flash: boolean;
  iframes: string[];
  jsonLdTypes: string[];
  copyrightYear: number | null;
  ctaTexts: string[];
  ctaAboveFold: boolean;
  forms: FormInfo[];
  hasNav: boolean;
  hasMain: boolean;
  hasFooter: boolean;
  sectionAnchors: number;
  mixedContent: number;
  placeholderSignals: string[];
  challengeSignals: string[];
  hasPasswordField: boolean;
  privacyLink: boolean;
  addressLike: string | null;
  hoursLike: string | null;
};

const SOCIAL: [string, RegExp][] = [
  ["facebook", /facebook\.com\//i],
  ["instagram", /instagram\.com\//i],
  ["linkedin", /linkedin\.com\//i],
  ["x", /(twitter|x)\.com\//i],
  ["youtube", /youtube\.com\//i],
  ["tiktok", /tiktok\.com\//i],
  ["yelp", /yelp\.[a-z.]+\//i],
  ["pinterest", /pinterest\.[a-z.]+\//i],
];

export const CTA_PATTERN = /\b(book|schedule|reserve|order|get (a )?(free )?(quote|estimate)|request (a )?(quote|estimate|appointment|consultation)|call (us|now|today)|contact us|get started|free consultation|buy|shop now|enquire|inquire|sign up|join)\b/i;

const PLATFORM_SIGNS: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes|wordpress/i],
  ["Wix", /wix\.com|wixstatic|_wixCssImports/i],
  ["Squarespace", /squarespace/i],
  ["Shopify", /cdn\.shopify|shopify/i],
  ["GoDaddy Website Builder", /godaddy|img1\.wsimg\.com/i],
  ["Weebly", /weebly/i],
  ["Webflow", /webflow/i],
  ["Duda", /dudaone|duda\.co|multiscreensite/i],
  ["Google Sites / Business Profile site", /sites\.google|business\.site/i],
  ["Joomla", /joomla/i],
  ["Drupal", /drupal/i],
  ["Next.js", /__next|_next\/static/i],
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|example\.|sentry|wixpress|godaddy|domain\.com|email\.com|yourdomain|@2x/i;

export function analyzeHtml(html: string, meta: { url: string; status: number; ms: number; bytes: number; headers: Record<string, string> }): PageData {
  const $ = cheerio.load(html);
  const base = new URL(meta.url);
  const host = base.hostname.replace(/^www\./, "");

  const attr = (sel: string, a: string) => $(sel).first().attr(a)?.trim() || null;
  const metaContent = (name: string) => attr(`meta[name="${name}" i]`, "content") ?? attr(`meta[property="${name}" i]`, "content");

  // JSON-LD before stripping scripts
  const jsonLdTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const collect = (d: unknown) => {
        if (Array.isArray(d)) d.forEach(collect);
        else if (d && typeof d === "object") {
          const t = (d as Record<string, unknown>)["@type"];
          if (typeof t === "string") jsonLdTypes.push(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && jsonLdTypes.push(x));
          const g = (d as Record<string, unknown>)["@graph"];
          if (g) collect(g);
        }
      };
      collect(data);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const scriptsAll = $("script");
  const externalScripts = $("script[src]");
  let jqueryVersion: string | null = null;
  externalScripts.each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const m = src.match(/jquery[.-]?(\d+\.\d+(\.\d+)?)/i);
    if (m) jqueryVersion = m[1]!;
  });
  const inlineCss = $("style").text();
  const rawHtmlLower = html.slice(0, 400000);

  let platform: string | null = null;
  const generator = metaContent("generator");
  for (const [name, re] of PLATFORM_SIGNS) {
    if (re.test(generator ?? "") || re.test(rawHtmlLower)) {
      platform = name;
      break;
    }
  }

  // Links
  const internalLinks: { href: string; text: string }[] = [];
  const externalLinks: string[] = [];
  const telLinks: string[] = [];
  const mailtoEmails: string[] = [];
  const socialLinks: Record<string, string> = {};
  let mixedContent = 0;
  let sectionAnchors = 0;
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
    if (!href) return;
    if (href.startsWith("tel:")) return void telLinks.push(href.slice(4));
    if (href.startsWith("mailto:")) {
      const e = decodeURIComponent(href.slice(7).split("?")[0] ?? "").toLowerCase();
      if (e && !IGNORED_EMAIL.test(e)) mailtoEmails.push(e);
      return;
    }
    if (href.startsWith("#")) {
      if (href.length > 1) sectionAnchors++;
      return;
    }
    if (/^javascript:/i.test(href)) return;
    try {
      const u = new URL(href, base);
      const h = u.hostname.replace(/^www\./, "");
      for (const [name, re] of SOCIAL) if (re.test(u.toString()) && !socialLinks[name]) socialLinks[name] = u.toString();
      if (h === host) {
        u.hash = "";
        internalLinks.push({ href: u.toString(), text });
      } else externalLinks.push(u.toString());
    } catch {
      /* ignore */
    }
  });
  if (base.protocol === "https:") {
    $("img[src^='http:'], script[src^='http:'], link[rel=stylesheet][href^='http:'], iframe[src^='http:']").each(() => void mixedContent++);
  }

  // Images
  const imgs = $("img");
  let missingAlt = 0, lazy = 0, withDims = 0, legacy = 0, modern = 0;
  imgs.each((_, el) => {
    const $el = $(el);
    if ($el.attr("alt") === undefined) missingAlt++;
    if (($el.attr("loading") ?? "").toLowerCase() === "lazy" || $el.attr("data-src")) lazy++;
    if ($el.attr("width") && $el.attr("height")) withDims++;
    const src = ($el.attr("src") ?? $el.attr("data-src") ?? "").toLowerCase();
    if (/\.(webp|avif)(\?|$)/.test(src)) modern++;
    else if (/\.(jpe?g|png|gif|bmp)(\?|$)/.test(src)) legacy++;
  });
  if ($("picture source[type='image/webp'], picture source[type='image/avif']").length) modern += $("picture").length;

  // Forms
  const forms: FormInfo[] = [];
  $("form").each((_, el) => {
    const $f = $(el);
    const fields: FormInfo["fields"] = [];
    $f.find("input, textarea, select").each((__, inp) => {
      const $i = $(inp);
      const type = (inp.tagName === "input" ? $i.attr("type") ?? "text" : inp.tagName).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
      const id = $i.attr("id");
      const label = (id ? $(`label[for="${id}"]`).text().trim() : "") || $i.attr("aria-label") || $i.attr("placeholder") || null;
      fields.push({ name: ($i.attr("name") ?? id ?? "").toLowerCase(), type, label });
    });
    const blob = `${$f.attr("action") ?? ""} ${$f.attr("id") ?? ""} ${$f.attr("class") ?? ""} ${fields.map((f) => `${f.name} ${f.label ?? ""}`).join(" ")} ${$f.text().slice(0, 300)}`.toLowerCase();
    const purpose = /search/.test(blob) && fields.length <= 2 ? "search" : /newsletter|subscribe/.test(blob) && fields.length <= 3 ? "newsletter" : /password|login|sign ?in/.test(blob) ? "login" : /quote|estimate/.test(blob) ? "quote" : /book|appointment|reserv|date/.test(blob) ? "booking" : /message|comment|inquir|enquir|contact/.test(blob) ? "contact" : "other";
    forms.push({
      action: $f.attr("action") ?? null,
      method: ($f.attr("method") ?? "get").toLowerCase(),
      fields,
      hasSubmit: $f.find("button, input[type=submit], input[type=image]").length > 0,
      purpose,
    });
  });

  const hasPasswordField = $("input[type=password]").length > 0;
  const deprecatedTags = $("font, center, marquee, blink, frameset, frame, basefont, big, tt, strike").length;
  const layoutTables = $("table").filter((_, t) => $(t).find("table").length > 0 || ($(t).find("th").length === 0 && $(t).find("img").length > 2)).length;
  const flash = $("object[type*='flash'], embed[src$='.swf'], object[data$='.swf']").length > 0;
  const iframes = $("iframe[src]").map((_, el) => $(el).attr("src")!).get();

  // Headings
  const hText = (sel: string) => $(sel).map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 30);
  const h1 = hText("h1");
  const h2 = hText("h2");
  const h3 = hText("h3");

  // CTA detection: look at links/buttons; "above fold" approximated as first ~25% of body DOM order
  const ctaTexts: string[] = [];
  const clickable = $("a, button, input[type=submit]");
  const totalClickable = clickable.length || 1;
  let ctaAboveFold = false;
  clickable.each((i, el) => {
    const t = ($(el).text() || $(el).attr("value") || $(el).attr("aria-label") || "").replace(/\s+/g, " ").trim();
    if (t && t.length < 60 && CTA_PATTERN.test(t)) {
      ctaTexts.push(t);
      if (i / totalClickable < 0.25 || i < 8) ctaAboveFold = true;
    }
  });

  // Visible text
  $("script, style, noscript, svg, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(" ").length : 0;
  const textEmails = Array.from(new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()).filter((e) => !IGNORED_EMAIL.test(e))));

  const years = Array.from(text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)).map((m) => Number(m[1]));
  const copyrightYear = years.length ? Math.max(...years) : null;

  const placeholderSignals: string[] = [];
  if (/lorem ipsum/i.test(text)) placeholderSignals.push("Lorem ipsum placeholder text");
  if (/(coming soon|under construction|site is being built|launching soon)/i.test(text) && wordCount < 300) placeholderSignals.push("“Coming soon / under construction” page");
  if (/(this domain (is|may be) for sale|buy this domain|parked free|domain parking|godaddy\.com\/domains)/i.test(text)) placeholderSignals.push("Parked domain");
  if (/(default web site page|welcome to nginx|apache2 ubuntu default page|it works!)/i.test(text)) placeholderSignals.push("Default web-server page");

  const challengeSignals: string[] = [];
  if (/(just a moment\.\.\.|checking your browser|attention required|cf-browser-verification|cf-challenge)/i.test(rawHtmlLower)) challengeSignals.push("Bot-protection challenge page");
  if (/(g-recaptcha|h-captcha|hcaptcha\.com|captcha)/i.test(rawHtmlLower) && wordCount < 150) challengeSignals.push("CAPTCHA gate");

  const addressMatch = text.match(/\d{1,6}\s+[A-Z][\w.'-]*(\s[\w.'-]+){0,4}\s(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Cres|Crescent|Ct|Court|Pkwy|Parkway|Hwy|Highway|Pl|Place)\b\.?[^.]{0,60}/);
  const hoursMatch = text.match(/((Mon|Monday|Tue|Tues|Tuesday|Wed|Thu|Thurs|Fri|Sat|Sun)[a-z]*\.?\s*[-–:to ]+\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)?[a-z]*\.?\s*:?\s*\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)?\s*[-–to]+\s*\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)?)/);

  return {
    url: meta.url,
    status: meta.status,
    ms: meta.ms,
    bytes: meta.bytes,
    compressed: /gzip|br|deflate|zstd/i.test(meta.headers["content-encoding"] ?? ""),
    title: $("title").first().text().replace(/\s+/g, " ").trim() || null,
    metaDescription: metaContent("description"),
    metaRobots: metaContent("robots"),
    lang: $("html").attr("lang") ?? null,
    viewport: metaContent("viewport"),
    canonical: attr('link[rel="canonical"]', "href"),
    og: { title: metaContent("og:title"), description: metaContent("og:description"), image: metaContent("og:image") },
    favicon: $('link[rel*="icon"]').length > 0,
    generator,
    platform,
    h1,
    h2,
    h3,
    wordCount,
    text: text.slice(0, 40000),
    internalLinks,
    externalLinks: Array.from(new Set(externalLinks)).slice(0, 200),
    navLinkCount: $("nav a, header a").length,
    telLinks: Array.from(new Set(telLinks)),
    mailtoEmails: Array.from(new Set(mailtoEmails)),
    textEmails,
    socialLinks,
    images: { total: imgs.length, missingAlt, lazy, withDims, legacyFormat: legacy, modernFormat: modern },
    scripts: { total: scriptsAll.length, external: externalScripts.length, jqueryVersion },
    stylesheets: $('link[rel="stylesheet"]').length,
    inlineStyleAttrs: $("[style]").length,
    hasMediaQueries: /@media/i.test(inlineCss) || /bootstrap|tailwind|foundation|bulma|elementor|wp-block|wix|squarespace|webflow|shopify/i.test(rawHtmlLower),
    usesWebFonts: /fonts\.googleapis|fonts\.gstatic|use\.typekit|@font-face/i.test(rawHtmlLower),
    deprecatedTags,
    layoutTables,
    flash,
    iframes,
    jsonLdTypes: Array.from(new Set(jsonLdTypes)),
    copyrightYear,
    ctaTexts: Array.from(new Set(ctaTexts)).slice(0, 20),
    ctaAboveFold,
    forms,
    hasNav: $("nav").length > 0 || $('[role="navigation"]').length > 0,
    hasMain: $("main").length > 0,
    hasFooter: $("footer").length > 0,
    sectionAnchors,
    mixedContent,
    placeholderSignals,
    challengeSignals,
    hasPasswordField,
    privacyLink: /privacy/i.test(internalLinks.map((l) => `${l.href} ${l.text}`).join(" ")) || /privacy policy/i.test(text),
    addressLike: addressMatch ? addressMatch[0].trim().slice(0, 120) : null,
    hoursLike: hoursMatch ? hoursMatch[0].trim() : null,
  };
}

const PRIORITY_PATTERNS: [RegExp, number][] = [
  [/contact|get-in-touch/i, 10],
  [/service|what-we-do|treatments|practice-areas/i, 9],
  [/menu/i, 9],
  [/book|appointment|reserv|schedule/i, 9],
  [/quote|estimate/i, 9],
  [/about|our-story|who-we-are/i, 8],
  [/pric|rates|packages/i, 7],
  [/gallery|portfolio|our-work|projects/i, 6],
  [/faq/i, 6],
  [/team|staff/i, 5],
  [/review|testimonial/i, 5],
  [/location|areas|service-area/i, 5],
];

/** Picks the most informative internal pages to analyse next. */
export function pickPagesToCrawl(home: PageData, max: number): string[] {
  const seen = new Set<string>([normalise(home.url)]);
  const scored: { url: string; score: number }[] = [];
  for (const l of home.internalLinks) {
    let u: URL;
    try {
      u = new URL(l.href);
    } catch {
      continue;
    }
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?|mp4|mp3)$/i.test(u.pathname)) continue;
    if (/(wp-admin|wp-login|cart|checkout|account|login|signin|logout|feed|tag\/|category\/|\?replytocom)/i.test(u.toString())) continue;
    const key = normalise(u.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    const blob = `${u.pathname} ${l.text}`;
    const score = PRIORITY_PATTERNS.reduce((s, [re, w]) => (re.test(blob) ? Math.max(s, w) : s), 1) - u.pathname.split("/").length * 0.1;
    scored.push({ url: u.toString(), score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map((s) => s.url);
}

const normalise = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
