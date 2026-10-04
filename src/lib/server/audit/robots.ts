import "../guard";
import { politeFetch, ROBOTS_TOKEN } from "./fetcher";

type Rule = { allow: boolean; path: string };
export type RobotsPolicy = { isAllowed: (path: string) => boolean; crawlDelay: number | null; found: boolean; sitemaps: string[] };

export function parseRobots(txt: string, agent = ROBOTS_TOKEN): Omit<RobotsPolicy, "found"> {
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[]; delay: number | null } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "sitemap") sitemaps.push(value);
    if (!current) continue;
    if (field === "disallow") current.rules.push({ allow: false, path: value });
    else if (field === "allow") current.rules.push({ allow: true, path: value });
    else if (field === "crawl-delay") current.delay = Number(value) || null;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.find((g) => g.delay != null)?.delay ?? null;
  const matches = (path: string, pattern: string) => {
    if (!pattern) return false;
    const anchored = pattern.endsWith("$");
    const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
  };
  return {
    crawlDelay: delay,
    sitemaps,
    isAllowed(path: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (r.path === "" && !r.allow) continue; // "Disallow:" (empty) allows everything
        if (matches(path, r.path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

export async function fetchRobots(origin: string): Promise<RobotsPolicy> {
  try {
    const res = await politeFetch(`${origin}/robots.txt`, { timeoutMs: 6000, accept: "text/plain,*/*" });
    // RFC 9309: a 5xx robots.txt means "assume full disallow"; 4xx means no restrictions.
    if (res.status >= 500) return { isAllowed: () => false, crawlDelay: null, found: true, sitemaps: [] };
    if (res.status >= 400 || !/text\/plain|octet-stream/.test(res.headers["content-type"] ?? "text/plain")) {
      return { isAllowed: () => true, crawlDelay: null, found: false, sitemaps: [] };
    }
    return { ...parseRobots(res.body), found: true };
  } catch {
    // Unreachable robots.txt: treat as allow (standard behaviour) — the page fetch will surface real errors.
    return { isAllowed: () => true, crawlDelay: null, found: false, sitemaps: [] };
  }
}
