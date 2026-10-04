import { GENERAL_PLAYBOOK, PLAYBOOKS, type Playbook } from "./playbooks";

export type TypeSignal = { googleTypes?: string[]; category?: string | null; name?: string | null; siteText?: string | null };

/**
 * Deterministic business-type classification. Google place types are the
 * strongest signal, then the category label, then the business name, then the
 * website's own text. Returns "general" with low confidence when unclear.
 */
export function classifyBusinessType(sig: TypeSignal): { playbook: Playbook; confidence: number; evidence: string[] } {
  const scores = new Map<string, { score: number; evidence: string[] }>();
  const add = (p: Playbook, pts: number, ev: string) => {
    const cur = scores.get(p.id) ?? { score: 0, evidence: [] };
    cur.score += pts;
    cur.evidence.push(ev);
    scores.set(p.id, cur);
  };
  const types = (sig.googleTypes ?? []).map((t) => t.toLowerCase());
  for (const p of PLAYBOOKS) {
    const primaryHit = types[0] && p.googleTypes.includes(types[0]);
    if (primaryHit) add(p, 60, `Primary listing type “${types[0]}”`);
    else {
      const hit = types.find((t) => p.googleTypes.includes(t));
      if (hit) add(p, 35, `Listing type “${hit}”`);
    }
    if (sig.category && p.keywords.test(sig.category)) add(p, 30, `Category “${sig.category}”`);
    if (sig.name && p.keywords.test(sig.name)) add(p, 25, `Business name “${sig.name}”`);
    if (sig.siteText) {
      const m = sig.siteText.slice(0, 20000).match(new RegExp(p.keywords.source, "gi"));
      if (m && m.length >= 3) add(p, Math.min(20, m.length * 2), `Website mentions (${m.length}×)`);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const best = ranked[0];
  if (!best || best[1].score < 25) return { playbook: GENERAL_PLAYBOOK, confidence: 30, evidence: ["No strong category signal — treated as a general local business"] };
  const second = ranked[1]?.[1].score ?? 0;
  const margin = best[1].score - second;
  const confidence = Math.max(35, Math.min(98, Math.round(best[1].score * 0.8 + margin * 0.3)));
  return { playbook: PLAYBOOKS.find((p) => p.id === best[0])!, confidence, evidence: best[1].evidence };
}
