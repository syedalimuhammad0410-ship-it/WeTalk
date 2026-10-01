// Privacy-conscious product analytics: event names + coarse, non-identifying properties only.
// No user ids, no content, no free text. Profiles can opt out entirely.
import { run } from './db.ts';

const ALLOWED_PROPS = new Set(['mode', 'skill', 'domain', 'method', 'kind', 'ai', 'correct', 'band', 'score_bucket', 'source', 'feature']);

export function track(event: string, props: Record<string, unknown> = {}, optOut = false) {
  if (optOut) return;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (ALLOWED_PROPS.has(k) && ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = v;
  try { run('INSERT INTO analytics_events (event, props) VALUES (?, ?)', event.slice(0, 60), JSON.stringify(clean)); } catch { /* analytics must never break the app */ }
}
