import type { SiteData } from "./score";

export type WebsiteClassT = "NO_WEBSITE" | "OUTDATED" | "SINGLE_PAGE" | "BROKEN" | "INCOMPLETE" | "BASIC" | "MODERN" | "STRONG" | "EXCELLENT" | "MANUAL_REVIEW";

export function outdatedSignals(site: SiteData, now = new Date()): string[] {
  const h = site.home;
  const s: string[] = [];
  if (!h.viewport) s.push("No mobile viewport");
  if (h.deprecatedTags > 0) s.push("Obsolete HTML tags");
  if (h.layoutTables > 0) s.push("Table-based layout");
  if (h.flash) s.push("Flash/plug-in content");
  if (h.copyrightYear != null && now.getFullYear() - h.copyrightYear >= 4) s.push(`Copyright last updated ${h.copyrightYear}`);
  if (!site.https) s.push("No HTTPS");
  if (h.scripts.jqueryVersion && /^1\./.test(h.scripts.jqueryVersion)) s.push(`Old jQuery ${h.scripts.jqueryVersion}`);
  return s;
}

/** A site is "single-page" when nearly all content sits on one scrolling page. */
export function isSinglePage(site: SiteData) {
  const h = site.home;
  const distinctPaths = new Set(
    h.internalLinks
      .map((l) => {
        try {
          const u = new URL(l.href);
          return u.pathname.replace(/\/$/, "") || "/";
        } catch {
          return "/";
        }
      })
      .filter((p) => p !== "/" && !/privacy|terms|cookie|login|cart|wp-|feed/i.test(p)),
  );
  return distinctPaths.size <= 2 && (h.sectionAnchors >= 2 || h.h2.length >= 3);
}

export function classifySite(site: SiteData, overall: number, now = new Date()): { classification: WebsiteClassT; reasons: string[] } {
  const h = site.home;
  if (h.placeholderSignals.length) return { classification: "INCOMPLETE", reasons: h.placeholderSignals };
  const totalWords = [h, ...site.pages].reduce((s, p) => s + p.wordCount, 0);
  if (totalWords < 120) return { classification: "INCOMPLETE", reasons: [`Very little content (${totalWords} words)`] };
  if (overall >= 85) return { classification: "EXCELLENT", reasons: [`Overall score ${overall}/100`] };
  if (overall >= 75) return { classification: "STRONG", reasons: [`Overall score ${overall}/100`] };
  const old = outdatedSignals(site, now);
  if (old.length >= 2) return { classification: "OUTDATED", reasons: old };
  if (isSinglePage(site)) return { classification: "SINGLE_PAGE", reasons: ["Content is concentrated on one scrolling page with few or no sub-pages"] };
  if (overall >= 60) return { classification: "MODERN", reasons: [`Overall score ${overall}/100`] };
  return { classification: "BASIC", reasons: [`Overall score ${overall}/100`, ...old] };
}
