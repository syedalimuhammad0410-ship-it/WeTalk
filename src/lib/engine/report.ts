import type { Investigation } from "@/lib/types";

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(inv: Investigation): string {
  const rows: string[][] = [["section", "id", "name/title", "type/status", "confidence/strength", "detail", "url/sources"]];
  for (const c of inv.candidates)
    rows.push(["candidate", c.id, c.name, c.status, c.confidence, [c.city, c.country].filter(Boolean).join(", "), c.sourceIds.map((id) => inv.sources.find((s) => s.id === id)?.url).filter(Boolean).join(" ")]);
  for (const e of inv.evidence) rows.push(["evidence", e.id, e.statement, `${e.kind}/${e.polarity}`, e.strength, inv.candidates.find((c) => c.id === e.candidateId)?.name || "", e.sourceIds.join(" ")]);
  for (const c of inv.clues) rows.push(["clue", c.id, c.value, c.type, c.ignored ? "ignored" : "", c.engine, ""]);
  for (const s of inv.sources) rows.push(["source", s.id, s.title, s.category, s.reliability.tier, `${s.publisher}${s.verified ? "" : " (not fetched)"}`, s.url]);
  for (const q of inv.queries) rows.push(["query", q.id, q.text, q.kind, q.status, q.provider, ""]);
  for (const t of inv.timeline) rows.push(["timeline", t.id, t.label, t.kind, "", t.date, t.sourceIds.join(" ")]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function toMarkdown(inv: Investigation): string {
  const src = (ids: string[]) =>
    ids
      .map((id) => inv.sources.findIndex((s) => s.id === id))
      .filter((i) => i >= 0)
      .map((i) => `[${i + 1}]`)
      .join("");
  const c = inv.conclusion;
  const lines: string[] = [];
  lines.push(`# ${inv.title}`, "", `*TRACE investigation report · generated ${new Date().toISOString()} · mode: ${inv.mode}${inv.demo ? " · DEMO (public sample data)" : ""}*`, "");
  lines.push("## Result", "", `**${c?.headline || "No conclusion yet."}**`, "", `Confidence: **${c?.confidence || "—"}**`, "", c?.explanation || "", "");
  if (c?.reasons.length) lines.push("### Why", ...c.reasons.map((r) => `- ✓ ${r}`), "");
  if (c?.uncertainties.length) lines.push("### Uncertainty", ...c.uncertainties.map((r) => `- ⚠ ${r}`), "");
  if (c?.nextSteps.length) lines.push("### Next steps", ...c.nextSteps.map((r) => `- ${r}`), "");
  lines.push("## Images", ...inv.images.map((i) => `- ${i.name} (${i.width}×${i.height}, sha256 ${i.sha256.slice(0, 16)}…)${i.demoSource ? ` — ${i.demoSource.title}, ${i.demoSource.license}, ${i.demoSource.url}` : ""}`), "");
  lines.push("## Detected clues", ...inv.clues.filter((x) => !x.ignored).slice(0, 60).map((x) => `- **${x.type}** “${x.value}” — ${x.engine}`), "");
  lines.push("## Entities", ...inv.entities.map((e) => `- **${e.name}** (${e.type}) — ${e.detectedBecause.join("; ")} ${src(e.sourceIds)}`), "");
  if (inv.dossiers?.length) {
    lines.push("## Subjects in the image");
    for (const d of inv.dossiers) {
      lines.push(`### ${d.name} (${d.kind})`, d.description ? `_${d.description}_` : "", `Why researched: ${d.foundBecause}`, "");
      if (d.summary) lines.push(d.summary, "");
      for (const f of d.facts.filter((x) => x.group !== "links")) lines.push(`- **${f.label}:** ${f.value}${f.asOf ? ` (as of ${f.asOf})` : ""} ${src([f.sourceId])}`);
      const news = d.newsIds.map((id) => inv.sources.find((x) => x.id === id)).filter(Boolean).slice(0, 5);
      if (news.length) lines.push("", "Recent coverage:", ...news.map((n) => `- ${n!.title} — ${n!.publisher} ${src([n!.id])}`));
      lines.push("");
    }
  }
  lines.push("## Candidates");
  inv.candidates.forEach((cd, i) => {
    lines.push("", `### #${i + 1} ${cd.name}${cd.city ? `, ${cd.city}` : ""} — ${cd.status}, ${cd.confidence} confidence`);
    if (cd.rejectionReason) lines.push(`Rejected: ${cd.rejectionReason}`);
    for (const e of inv.evidence.filter((x) => x.candidateId === cd.id)) lines.push(`- [${e.kind} · ${e.polarity} · ${e.strength}] ${e.statement} ${src(e.sourceIds)}`);
    if (cd.falsification?.length) {
      lines.push("", "Disproof checks:");
      for (const f of cd.falsification) lines.push(`- ${f.outcome.toUpperCase()}: ${f.question} — ${f.result}`);
    }
  });
  lines.push("");
  if (inv.contradictions.length) lines.push("## Contradictions", ...inv.contradictions.map((x) => `- ⚠ ${x.subject} — ${x.property}: ${x.claims.map((cl) => `${cl.value} ${src([cl.sourceId])}`).join(" vs ")}`), "");
  if (inv.timeline.length) lines.push("## Timeline", ...[...inv.timeline].sort((a, b) => a.year - b.year).map((t) => `- **${t.date}** ${t.label} ${src(t.sourceIds)}`), "");
  if (inv.notes.length) lines.push("## Notes (user-provided)", ...inv.notes.map((n) => `- ${n.text}`), "");
  lines.push("## Search queries", ...inv.queries.map((q) => `- [${q.kind} · ${q.provider} · ${q.status}] ${q.text}`), "");
  lines.push("## Sources", ...inv.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.publisher}. ${s.url} (accessed ${s.accessedAt.slice(0, 10)}; ${s.category}; ${s.reliability.tier}${s.verified ? "" : "; not fetched/verified by TRACE"}${s.usedInReasoning ? "; used in reasoning" : ""})`), "");
  lines.push("---", "TRACE separates direct evidence, indirect evidence, inference and user-provided information. Confidence levels are qualitative. Visual similarity is not proof of identity.");
  return lines.join("\n");
}

export function toText(inv: Investigation): string {
  return toMarkdown(inv)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1");
}

export function toJson(inv: Investigation): string {
  const { ownerEmail: _o, ...rest } = inv;
  void _o;
  return JSON.stringify({ format: "trace-investigation", version: 1, exportedAt: new Date().toISOString(), investigation: rest }, null, 2);
}
