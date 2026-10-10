// Evidence weighting, contradiction handling, false-positive protection and
// conclusion building. Pure functions — run on the client after every research step
// and on the server for chat answers. Scores are internal; the UI shows plain-language
// evidence states only.
import type { Candidate, Clue, Confidence, Conclusion, Evidence, EvidenceKind, Investigation, Strength } from "@/lib/types";
import { compact, nowIso, textSupport, uid, yearOf } from "@/lib/util";

const W = { exif: 3, text: 2.6, logo: 1.6, link: 1.3, visual: 2, geo: 1, temporal: 1.2, ai: 1.5 };

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface DateHint {
  year: number;
  origin: "exif" | "user" | "ocr";
  label: string;
}

export function imageDateHints(inv: Investigation): DateHint[] {
  const out: DateHint[] = [];
  for (const im of inv.images) {
    const y = yearOf(im.analysis?.exif?.takenAt);
    if (y) out.push({ year: y, origin: "exif", label: `photo metadata date (${im.analysis!.exif!.takenAt!.slice(0, 10)})` });
  }
  for (const n of inv.notes) if (n.yearHint) out.push({ year: n.yearHint, origin: "user", label: `your note (“${n.text.slice(0, 60)}”)` });
  for (const c of inv.clues) if (c.type === "date" && !c.ignored) {
    const y = yearOf(c.value);
    if (y && y > 1800 && y <= new Date().getFullYear()) out.push({ year: y, origin: "ocr", label: `date visible in the image (“${c.value}”)` });
  }
  return out;
}

const activeClues = (inv: Investigation) => {
  const focusTypes = inv.focus?.clueTypes;
  return inv.clues.filter((c) => !c.ignored && (!focusTypes?.length || focusTypes.includes(c.type)));
};

const textClues = (inv: Investigation) => activeClues(inv).filter((c) => ["text", "logo", "document", "address", "website"].includes(c.type) && c.value.trim().length >= 3);

function strengthOf(v: number): Strength {
  return v >= 0.8 ? "strong" : v >= 0.55 ? "moderate" : "weak";
}

interface Ev {
  kind: EvidenceKind;
  polarity: Evidence["polarity"];
  statement: string;
  strength: Strength;
  sourceIds: string[];
  clueIds: string[];
}

export function assess(inv: Investigation): Investigation {
  const next: Investigation = structuredClone(inv);
  const clues = textClues(next);
  const dates = imageDateHints(next);
  const exif = next.images.map((i) => i.analysis?.exif).find((e) => e?.lat !== undefined && e?.lng !== undefined);
  const cityEntities = next.entities.filter((e) => e.type === "city" || e.type === "region");
  const evidence: Evidence[] = next.evidence.filter((e) => e.kind === "user" && !e.candidateId);
  const scored: { c: Candidate; score: number; strongContra: boolean; direct: boolean; types: number }[] = [];

  // distinctive names across candidates (to detect "text names a different place")
  const allNames = next.candidates.flatMap((c) => c.names.map((n) => ({ cand: c.id, name: n.name })));

  for (const c of next.candidates) {
    const evs: Ev[] = [];
    const why: string[] = [];
    const against: string[] = [];
    const sig = { ...c.signals, text: null as number | null, logo: null as number | null, visual: null as number | null, geo: null as number | null, temporal: null as number | null, exif: null as number | null, link: null as number | null };
    const loc = next.locations.find((l) => l.id === c.locationId);
    const primarySrc = c.sourceIds.slice(0, 2);

    // ---- text: visible text naming the candidate (any historical name)
    const VENUE_WORDS = /\b(arena|stadium|center|centre|coliseum|field|park|dome|forum|garden|hall|pavilion|hotel|inn|restaurant|cafe|library|museum|station|church|tower|building|school|university|college|street|avenue|road|boulevard|square|bridge)\b/i;
    const matches: { score: number; clue: Clue; name: string; how: string; dated: boolean }[] = [];
    const GENERIC = /^(the|arena|stadium|center|centre|coliseum|field|park|dome|forum|garden|hall|pavilion|hotel|inn|restaurant|cafe|street|avenue|road|club|\s)+$/i;
    for (const cl of clues) {
      if (GENERIC.test(cl.value.trim())) continue; // a bare venue-type word identifies nothing
      for (const n of c.names.length ? c.names : [{ name: c.name }]) {
        const s = textSupport(cl.value, n.name);
        if (s.score < 0.45) continue;
        let adj = s.score * Math.min(1, 0.55 + cl.weight * 0.6);
        // a partial read that omits the place-type word ("State Farm" vs "State Farm Arena") may be a sponsor or brand
        if (s.how.startsWith("partial") && VENUE_WORDS.test(n.name) && !VENUE_WORDS.test(cl.value)) adj *= 0.72;
        const nm = c.names.find((x) => x.name === n.name);
        matches.push({ score: adj, clue: cl, name: n.name, how: s.how, dated: Boolean(nm?.from || nm?.to) });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const bestText = matches[0] || { score: 0, clue: undefined as Clue | undefined, name: "", how: "", dated: false };
    if (bestText.score >= 0.45 && bestText.clue) {
      sig.text = bestText.score;
      const exact = bestText.how === "exact" || bestText.how === "name contained in text";
      const st = `Visible text “${bestText.clue.value}” ${exact ? "matches" : "partially matches"} the name “${bestText.name}”${bestText.name !== c.name ? ` (a name this place has used)` : ""}.`;
      evs.push({ kind: exact ? "direct" : "indirect", polarity: "supports", statement: st, strength: strengthOf(bestText.score), sourceIds: primarySrc, clueIds: [bestText.clue.id] });
      why.push(st);
      // temporal inference from a dated historical name — only if no other matched name points to a different era
      const nm = c.names.find((n) => n.name === bestText.name);
      const otherEra = matches.find((m) => m.name !== bestText.name && m.score >= 0.5 && m.dated);
      if (nm && (nm.from || nm.to) && bestText.score >= 0.6 && !otherEra) {
        const st2 = `That name was in use ${nm.from ? `from ${nm.from}` : ""}${nm.from && nm.to ? " " : ""}${nm.to ? `until ${nm.to}` : ""}, so the photo likely dates from that period.`;
        evs.push({ kind: "inference", polarity: "neutral", statement: st2, strength: "moderate", sourceIds: primarySrc, clueIds: [bestText.clue.id] });
        why.push(st2);
      } else if (nm && (nm.from || nm.to) && otherEra) {
        const st3 = `Visible text matches names from different periods (“${bestText.name}” and “${otherEra.name}”); one may be a sponsor, so no date is inferred from the name.`;
        evs.push({ kind: "inference", polarity: "neutral", statement: st3, strength: "weak", sourceIds: primarySrc, clueIds: [bestText.clue.id, otherEra.clue.id] });
        against.push(st3);
      }
    }

    // ---- link: candidate derived from an entity found in the image (e.g. team → home venue)
    const linkedEntities = next.entities.filter((e) => c.derivedFrom.some((d) => compact(d) === compact(e.name)) && e.name !== c.name);
    if (linkedEntities.length) {
      const e = linkedEntities[0];
      // entities found only by probabilistic visual recognition (no readable text) stay weak
      const visualOnly = e.clueIds.length > 0 && e.clueIds.every((id) => next.clues.find((cl) => cl.id === id)?.origin === "vision-model");
      const q = visualOnly ? 0.3 : e.matchQuality === "strong" ? 0.85 : e.matchQuality === "moderate" ? 0.65 : 0.4;
      sig.link = q;
      const fromLogo = e.clueIds.some((id) => next.clues.find((cl) => cl.id === id)?.type === "logo");
      if (fromLogo) sig.logo = q;
      const st = `${e.name} was identified from ${fromLogo ? "a logo" : "text"} in the image, and public records connect it to this place (${c.why[0] || "see sources"}).`;
      evs.push({ kind: "indirect", polarity: "supports", statement: st, strength: strengthOf(q), sourceIds: Array.from(new Set([...e.sourceIds, ...primarySrc])), clueIds: e.clueIds });
      why.push(st);
      if (e.type === "sports_team") {
        const otherTeams = next.entities.filter((x) => x.type === "sports_team" && x.id !== e.id);
        const note = otherTeams.length
          ? `Other team branding is also visible (${otherTeams.map((t) => t.name).join(", ")}); this could be an away game at the other team's venue.`
          : "A team's branding does not by itself prove a home game — away, neutral-site or exhibition venues remain possible.";
        against.push(note);
        evs.push({ kind: "inference", polarity: otherTeams.length ? "contradicts" : "neutral", statement: note, strength: "weak", sourceIds: [], clueIds: [] });
      }
    }

    // ---- EXIF GPS
    if (exif && loc) {
      const km = haversineKm({ lat: exif.lat!, lng: exif.lng! }, loc);
      if (km < 0.6) {
        sig.exif = 1;
        const st = `The photo's GPS metadata is ${km < 0.1 ? "at" : `${Math.round(km * 1000)} m from`} this location.`;
        evs.push({ kind: "direct", polarity: "supports", statement: st, strength: "strong", sourceIds: loc.sourceIds, clueIds: [] });
        why.push(st);
      } else if (km < 8) {
        sig.exif = 0.5;
        const st = `The photo's GPS metadata is ${km.toFixed(1)} km away — nearby but not at this place.`;
        evs.push({ kind: "direct", polarity: "neutral", statement: st, strength: "moderate", sourceIds: loc.sourceIds, clueIds: [] });
        against.push(st);
      } else {
        sig.exif = -1;
        const st = `The photo's GPS metadata places it ${Math.round(km)} km away from this candidate.`;
        evs.push({ kind: "direct", polarity: "contradicts", statement: st, strength: "strong", sourceIds: loc.sourceIds, clueIds: [] });
        against.push(st);
      }
    }

    // ---- geographic consistency with city names seen in the image
    if (c.city || c.region) {
      const cityHit = cityEntities.find((e) => compact(e.name) === compact(c.city || "") || compact(e.name) === compact(c.region || ""));
      const textHit = clues.find((cl) => c.city && compact(cl.value).length >= 3 && textSupport(cl.value, c.city).score >= 0.9);
      if (cityHit || textHit) {
        sig.geo = 0.8;
        const st = `The city “${c.city}” is ${textHit ? `named in visible text (“${textHit.value}”)` : "among the entities found in the image"}.`;
        evs.push({ kind: "inference", polarity: "supports", statement: st, strength: "moderate", sourceIds: primarySrc, clueIds: textHit ? [textHit.id] : cityHit?.clueIds || [] });
        why.push(st);
      }
    }

    // ---- flags seen in the image vs the candidate's country
    const flagClues = activeClues(next).filter((cl) => cl.type === "flag");
    if (flagClues.length && c.country) {
      const match = flagClues.find((f) => compact(f.value) === compact(c.country!) || (compact(c.country!).includes("unitedstates") && /unitedstates|usa/.test(compact(f.value))) || (compact(c.country!).includes("unitedkingdom") && /england|scotland|wales|unitedkingdom/.test(compact(f.value))));
      if (match) {
        sig.geo = Math.max(sig.geo ?? 0, 0.7);
        const st = `A ${match.value} flag is visible in the image, consistent with this place being in ${c.country}.`;
        evs.push({ kind: "inference", polarity: "supports", statement: st, strength: match.weight >= 0.6 ? "moderate" : "weak", sourceIds: primarySrc, clueIds: [match.id] });
        why.push(st);
      } else {
        const st = `Visible flag(s) (${flagClues.map((f) => f.value).join(", ")}) do not match ${c.country}; flags can also appear at international events, so this is weak evidence.`;
        const strongFlag = flagClues.some((f) => f.weight >= 0.6);
        evs.push({ kind: "inference", polarity: "contradicts", statement: st, strength: strongFlag ? "moderate" : "weak", sourceIds: [], clueIds: flagClues.map((f) => f.id) });
        against.push(st);
        if (strongFlag) sig.geo = Math.min(sig.geo ?? 0, -0.6);
      }
    }

    // ---- temporal consistency
    const from = yearOf(c.activeFrom) ?? yearOf(c.inception);
    const to = yearOf(c.activeTo);
    const closed = next.timeline.find((t) => t.candidateId === c.id && t.kind === "closure")?.year;
    for (const d of dates) {
      const kind: EvidenceKind = d.origin === "user" ? "user" : d.origin === "exif" ? "direct" : "inference";
      const before = from && d.year < from - 0;
      const after = (to && d.year > to) || (closed && d.year > closed);
      if (before || after) {
        sig.temporal = Math.min(sig.temporal ?? 0, -0.8);
        const st = `The image date (${d.year}, from ${d.label}) falls outside this candidate's period${from || to ? ` (${from || "?"}–${to || closed || "present"})` : ""}.`;
        evs.push({ kind, polarity: "contradicts", statement: st, strength: d.origin === "ocr" ? "weak" : "strong", sourceIds: primarySrc, clueIds: [] });
        against.push(st);
      } else if (from || to) {
        sig.temporal = Math.max(sig.temporal ?? 0, d.origin === "ocr" ? 0.4 : 0.7);
        const st = `The image date (${d.year}, from ${d.label}) is consistent with this candidate's period (${from || "?"}–${to || "present"}).`;
        evs.push({ kind, polarity: "supports", statement: st, strength: d.origin === "ocr" ? "weak" : "moderate", sourceIds: primarySrc, clueIds: [] });
        why.push(st);
      }
    }
    // name-era inference vs tenancy window
    const matchedName = c.names.find((n) => n.name === bestText.name);
    if (matchedName?.to && from && to) {
      const nTo = yearOf(matchedName.to)!;
      const nFrom = yearOf(matchedName.from) ?? from;
      const overlap = Math.min(nTo, to) >= Math.max(nFrom, from);
      if (!overlap) {
        const st = `The visible name “${matchedName.name}” was in use (${nFrom}–${nTo}) outside the tenancy period that links this place to the image (${from}–${to}).`;
        evs.push({ kind: "inference", polarity: "contradicts", statement: st, strength: "moderate", sourceIds: primarySrc, clueIds: [] });
        against.push(st);
      }
    }
    if (!dates.length && (from || to)) against.push("The photo's date is unknown, so the time period cannot be checked (the place may have looked different at other times).");

    // ---- visual comparison (only real comparisons count)
    const compared = c.images.filter((i) => i.comparison && i.comparison.overall !== undefined);
    if (compared.length) {
      const best = compared.reduce((a, b) => ((b.comparison!.embedding ?? 0) > (a.comparison!.embedding ?? 0) ? b : a));
      const cmp = best.comparison!;
      const v = cmp.embedding ?? 0;
      const visualScore = v >= 0.86 ? 0.9 : v >= 0.79 ? 0.7 : v >= 0.71 ? 0.45 : v >= 0.66 ? 0.2 : 0;
      sig.visual = visualScore;
      if (cmp.overall === "none" || visualScore === 0) {
        const st = `${compared.length} reference photo${compared.length > 1 ? "s were" : " was"} compared; none closely resembles the image (photos may differ in angle, era or framing).`;
        evs.push({ kind: "indirect", polarity: "contradicts", statement: st, strength: "weak", sourceIds: compared.map((i) => i.sourceId), clueIds: [] });
        against.push(st);
      } else {
        const st = `Reference photo “${best.title}” shows ${cmp.overall} visual similarity to the image${cmp.notes.length ? ` (${cmp.notes.slice(0, 2).join("; ")})` : ""}.`;
        evs.push({ kind: "indirect", polarity: "supports", statement: st, strength: cmp.overall as Strength, sourceIds: [best.sourceId], clueIds: [] });
        why.push(st);
      }
    } else if (c.images.length) {
      against.push("Reference photos were found but not yet visually compared.");
    }

    // ---- text that names a *different* candidate
    const otherNamed = allNames.filter((n) => n.cand !== c.id && !c.names.some((m) => compact(m.name) === compact(n.name)));
    for (const cl of clues) {
      const hit = otherNamed.find((n) => textSupport(cl.value, n.name).score >= 0.85 && compact(n.name).length >= 6);
      if (hit && !(sig.text && sig.text >= 0.85)) {
        const st = `Visible text “${cl.value}” names a different candidate (${hit.name}).`;
        evs.push({ kind: "indirect", polarity: "contradicts", statement: st, strength: "moderate", sourceIds: [], clueIds: [cl.id] });
        against.push(st);
        sig.text = Math.min(sig.text ?? 0, -0.4);
        break;
      }
    }

    // ---- a confident AI geolocation puts a place with the same name somewhere else (namesake disambiguation)
    if (!sig.ai && loc) {
      for (const a of next.candidates) {
        if (a.id === c.id || (a.signals.ai ?? 0) < 0.45) continue;
        const al = next.locations.find((l) => l.id === a.locationId);
        if (!al) continue;
        const shared = a.names.some((n) => c.names.some((m) => compact(m.name) === compact(n.name)) || compact(n.name) === compact(c.name));
        const km = haversineKm(loc, al);
        if (shared && km > 15) {
          const st = `AI geolocation reads the scene as ${a.city || a.name} (${Math.round(km)} km away) — a different place that shares the name “${c.names[0]?.name || c.name}”.`;
          evs.push({ kind: "inference", polarity: "contradicts", statement: st, strength: (a.signals.ai ?? 0) >= 0.7 ? "moderate" : "weak", sourceIds: a.sourceIds.slice(0, 2), clueIds: [] });
          against.push(st);
          sig.geo = Math.min(sig.geo ?? 0, (a.signals.ai ?? 0) >= 0.7 ? -0.7 : -0.4);
          break;
        }
      }
    }

    // ---- AI geolocation estimate (a hypothesis, never direct evidence)
    if (sig.ai) {
      const aiWhy = c.why.find((w) => w.startsWith("AI geolocation"));
      const st = `An AI geolocation model proposed this location${aiWhy ? ` — ${aiWhy.replace(/^AI geolocation \([^)]*\):\s*/, "")}` : ""}. This is an inference from visual clues, checked against map data.`;
      evs.push({ kind: "inference", polarity: "supports", statement: st, strength: strengthOf(sig.ai), sourceIds: primarySrc, clueIds: [] });
    }

    // ---- source contradictions about this candidate
    for (const cx of next.contradictions.filter((x) => compact(x.subject) === compact(c.name))) {
      const st = `⚠ Sources disagree about ${cx.property}: ${cx.claims.map((x) => x.value).join(" vs ")}.`;
      evs.push({ kind: "direct", polarity: "neutral", statement: st, strength: "moderate", sourceIds: cx.claims.map((x) => x.sourceId), clueIds: [] });
      against.push(st);
    }

    // ---- source quality
    const srcs = next.sources.filter((s) => c.sourceIds.includes(s.id));
    const verified = srcs.filter((s) => s.verified && s.reliability.tier !== "tertiary");
    sig.source = Math.min(1, verified.length / 3);

    // ---- user notes mentioning the candidate
    for (const n of next.notes) {
      if (compact(n.text).includes(compact(c.name)) || (c.city && compact(n.text).includes(compact(c.city)))) {
        evs.push({ kind: "user", polarity: "neutral", statement: `You noted: “${n.text}” (user-provided, not independently verified).`, strength: "weak", sourceIds: [], clueIds: [] });
      }
    }

    // ---- scoring
    const parts: [keyof typeof W, number | null][] = [
      ["exif", sig.exif],
      ["text", sig.text],
      ["logo", sig.logo],
      ["link", sig.link],
      ["visual", sig.visual],
      ["geo", sig.geo],
      ["temporal", sig.temporal],
      ["ai", sig.ai ?? null],
    ];
    let score = 0;
    let types = 0;
    for (const [k, v] of parts) {
      if (v === null) continue;
      score += W[k] * v;
      if (v >= 0.4) types++;
    }
    const strongContra = evs.some((e) => e.polarity === "contradicts" && e.strength === "strong");
    const direct = (sig.text ?? 0) >= 0.6 || (sig.exif ?? 0) >= 1;

    const created: Evidence[] = evs.map((e) => ({ id: uid("ev"), candidateId: c.id, createdAt: nowIso(), ...e }));
    evidence.push(...created);
    c.signals = sig;
    c.why = Array.from(new Set([...c.why.filter((w) => !why.includes(w)), ...why]));
    c.against = Array.from(new Set(against));
    c.evidenceIds = created.map((e) => e.id);
    scored.push({ c, score, strongContra, direct, types });
  }

  // rank, label, reject, and falsify
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  for (const s of scored) {
    const { c } = s;
    c.status = "active";
    c.rejectionReason = undefined;
    if (s.strongContra) {
      c.status = "rejected";
      c.rejectionReason = c.against.find((a) => /outside|km away|GPS/.test(a)) || "Strong contradicting evidence.";
    }
    c.confidence = confidenceFor(s, s === top ? second : top);
    c.confidenceReasons = reasonsFor(c, s, s === top ? second : top);
  }
  const lead = scored.find((s) => s.c.status !== "rejected" && s.c.confidence !== "insufficient");
  if (lead) {
    lead.c.status = "leading";
    lead.c.falsification = falsify(next, lead.c, scored.filter((s) => s !== lead).map((s) => s.c), dates);
  }
  next.candidates = scored.map((s) => s.c);
  next.evidence = evidence;
  next.conclusion = buildConclusion(next, lead?.c);
  // mark sources used in reasoning
  const used = new Set(evidence.flatMap((e) => e.sourceIds));
  for (const s of next.sources) if (used.has(s.id)) s.usedInReasoning = true;
  return next;
}

function confidenceFor(s: { score: number; strongContra: boolean; direct: boolean; types: number }, rival?: { score: number }): Confidence {
  const margin = rival ? s.score - rival.score : s.score;
  if (s.strongContra) return s.score > 2 ? "low" : "insufficient";
  if (s.score >= 4.2 && s.direct && s.types >= 3 && margin >= 1.2) return "high";
  if (s.score >= 2.4 && s.types >= 2 && margin >= 0.4) return "moderate";
  if (s.score >= 1) return "low";
  return "insufficient";
}

function reasonsFor(c: Candidate, s: { score: number; strongContra: boolean; direct: boolean; types: number }, rival?: { c: Candidate; score: number }): string[] {
  const r: string[] = [];
  if (c.confidence === "high") r.push(`High confidence because ${s.types} independent kinds of evidence agree, including direct evidence, and nothing strongly contradicts it.`);
  if (c.confidence === "moderate") r.push(`Moderate confidence: ${s.types} kinds of evidence support it${s.direct ? ", including direct evidence" : ", but no direct evidence names it"}.`);
  if (c.confidence === "low") r.push("Low confidence: only limited or indirect evidence supports this candidate.");
  if (c.confidence === "insufficient") r.push("Insufficient evidence to support this candidate.");
  if (rival && Math.abs(s.score - rival.score) < 0.6 && c.status !== "rejected") r.push(`Confidence limited because ${rival.c.name} explains the clues almost as well.`);
  if (c.against.length) r.push(`Confidence limited by: ${c.against[0]}`);
  if (c.signals.visual === null && c.images.length === 0) r.push("No reference photos were compared.");
  return r;
}

function falsify(inv: Investigation, c: Candidate, others: Candidate[], dates: DateHint[]): NonNullable<Candidate["falsification"]> {
  const out: NonNullable<Candidate["falsification"]> = [];
  const from = yearOf(c.activeFrom) ?? yearOf(c.inception);
  const to = yearOf(c.activeTo);
  out.push(
    dates.length
      ? {
          question: "Does the image's date fall within this place's relevant period?",
          result: dates.map((d) => `${d.year} (${d.origin})`).join(", ") + ` vs ${from || "?"}–${to || "present"}`,
          outcome: c.against.some((a) => a.includes("falls outside")) ? "failed" : "passed",
        }
      : { question: "Does the image's date fall within this place's relevant period?", result: "Image date unknown — add a note with an approximate year to test this.", outcome: "inconclusive" },
  );
  const contraText = c.against.find((a) => a.startsWith("Visible text"));
  out.push({ question: "Does any visible text name a different place?", result: contraText || "No visible text names a competing candidate.", outcome: contraText ? "failed" : "passed" });
  const cmp = c.images.filter((i) => i.comparison);
  out.push({
    question: "Do reference photographs of this place resemble the image?",
    result: cmp.length ? `${cmp.length} compared; best similarity: ${["strong", "moderate", "weak", "none"].find((lvl) => cmp.some((i) => i.comparison!.overall === lvl))}` : "Not compared yet.",
    outcome: !cmp.length ? "inconclusive" : (c.signals.visual ?? 0) >= 0.45 ? "passed" : (c.signals.visual ?? 0) > 0 ? "inconclusive" : "failed",
  });
  const rival = others.filter((o) => o.status !== "rejected")[0];
  out.push({
    question: "Could a different candidate explain the same clues equally well?",
    result: rival ? `Closest alternative: ${rival.name} (${rival.confidence} confidence).` : "No competing candidate remains.",
    outcome: rival && (rival.confidence === c.confidence) ? "failed" : "passed",
  });
  const teamLink = inv.entities.filter((e) => e.type === "sports_team");
  if (teamLink.length) {
    out.push({
      question: "Could this be an away, neutral-site or exhibition game?",
      result: teamLink.length > 1 ? `Multiple teams' branding detected: ${teamLink.map((t) => t.name).join(", ")}.` : "Only one team's branding was linked; venue-specific text or visuals are needed to rule out other venues.",
      outcome: (c.signals.text ?? 0) >= 0.6 ? "passed" : "inconclusive",
    });
  }
  const cx = inv.contradictions.filter((x) => compact(x.subject) === compact(c.name));
  out.push({ question: "Do sources disagree about key facts for this place?", result: cx.length ? cx.map((x) => `${x.property}: ${x.claims.map((y) => y.value).join(" vs ")}`).join("; ") : "No source contradictions detected.", outcome: cx.length ? "inconclusive" : "passed" });
  return out;
}

export function buildConclusion(inv: Investigation, lead?: Candidate): Conclusion {
  const created = nowIso();
  const textCount = inv.clues.filter((c) => c.type === "text" && !c.ignored).length;
  const flagC = inv.clues.filter((c) => c.type === "flag" && !c.ignored && c.weight >= 0.55).sort((a, b) => b.weight - a.weight)[0];
  if (!lead && flagC) {
    return {
      candidateId: null,
      headline: `Possible country: ${flagC.value} (from visible flags)`,
      confidence: "low",
      reasons: [`The flag of ${flagC.value} was recognised in the image (${flagC.engine}).`],
      uncertainties: ["Flags can be displayed outside their country (embassies, events, fans abroad), so this indicates but does not prove the country.", "No specific place could be identified from the other clues."],
      explanation: `TRACE recognised the flag of ${flagC.value} but found no text, landmark or metadata that pins down a specific place. The country is a lead, not a conclusion.`,
      generatedBy: "rules",
      createdAt: created,
      nextSteps: ["Select a region around any sign or text and run “Investigate region”.", "Add a note with anything you know (city, event, date).", "Configure an AI vision provider (ANTHROPIC_API_KEY) for full scene reading."],
    };
  }
  // no place to pin down, but the image's subject was identified (a meme, a product, a company's ad…)
  const subject = (inv.dossiers || [])[0];
  if (!lead && subject) {
    const others = (inv.dossiers || []).slice(1, 4).map((x) => x.name);
    const fin = subject.facts.filter((f) => ["Revenue", "Net profit", "Headquarters", "Founded", "Created by", "First published"].includes(f.label)).slice(0, 3);
    return {
      candidateId: null,
      headline: `Image shows: ${subject.name}${subject.kind !== "other" ? ` (${subject.kind})` : ""}`,
      confidence: "moderate",
      reasons: [`${subject.foundBecause}.`, ...(subject.wikidataId ? [`Matched to the public record ${subject.wikidataId} (Wikidata).`] : [])],
      uncertainties: ["No specific location could be identified; this result describes what the image shows rather than where it was taken."],
      explanation: `${subject.name}${subject.description ? ` — ${subject.description}` : ""}. ${fin.map((f) => `${f.label}: ${f.value}${f.asOf ? ` (${f.asOf})` : ""}`).join("; ")}${fin.length ? ". " : ""}${others.length ? `Also identified: ${others.join(", ")}. ` : ""}See the Subjects tab for the full profile with sources.`,
      generatedBy: "rules",
      createdAt: created,
      nextSteps: ["Open the Subjects tab for the full sourced profile.", "Ask TRACE AI a question about it (e.g. “what is their latest revenue?”)."],
    };
  }
  if (!lead) {
    return {
      candidateId: null,
      headline: "Insufficient evidence to identify the location.",
      confidence: "insufficient",
      reasons: inv.candidates.length ? [`${inv.candidates.length} candidate(s) were examined but none is supported well enough.`] : ["No candidate locations could be generated from the clues found."],
      uncertainties: [
        textCount ? "Visible text did not resolve to a specific, documented place." : "Little or no legible text was found in the image.",
        "Environmental clues (architecture, vegetation, signage style) are probabilistic and cannot identify a place on their own.",
      ],
      explanation: `TRACE extracted ${inv.clues.length} clues and ran ${inv.queries.length} searches, but the evidence does not support any specific location. TRACE will not guess.`,
      generatedBy: "rules",
      createdAt: created,
      nextSteps: [
        "Select a region around a sign, logo or text and run “Investigate region”.",
        "Try image enhancement on blurry text, then re-run OCR.",
        "Add a note with anything you know (approximate year, city, event).",
        "Configure an AI vision or reverse-image provider in Settings for deeper analysis.",
      ],
    };
  }
  const evs = inv.evidence.filter((e) => e.candidateId === lead.id);
  const supports = evs.filter((e) => e.polarity === "supports");
  const uncertain = Array.from(new Set([...lead.against, ...lead.confidenceReasons.filter((r) => r.startsWith("Confidence limited"))])).slice(0, 6);
  const alts = inv.candidates.filter((c) => c.id !== lead.id && c.status !== "rejected").slice(0, 3);
  // skip parts the name already contains ("Broadway, New York City" + "New York City")
  const place = [lead.name, lead.city, lead.country].filter((p, i, all): p is string => Boolean(p) && !all.slice(0, i).some((q) => q && compact(q).includes(compact(p!)))).join(", ");
  const parts: string[] = [];
  const teamEnt = inv.entities.find((e) => lead.derivedFrom.includes(e.name) && e.type === "sports_team");
  if (lead.signals.text && lead.signals.text > 0.45) parts.push(`I found visible text that matches the name of ${lead.name}${lead.names.length > 1 ? " (including names it has used historically)" : ""}.`);
  if (teamEnt) parts.push(`I identified ${teamEnt.name} from the image and used public records of the team's home venues to generate candidates.`);
  if (lead.signals.exif === 1) parts.push("The photo's own GPS metadata points to this location.");
  if (lead.signals.visual !== null) parts.push(lead.signals.visual >= 0.45 ? "Reference photographs of the candidate show meaningful visual similarity to the image." : "Visual comparison with reference photographs was weak or inconclusive.");
  if (lead.signals.temporal !== null && lead.signals.temporal > 0) parts.push("The available date clues are consistent with the place's history.");
  parts.push(
    lead.confidence === "high"
      ? "Multiple independent lines of evidence agree, and the checks designed to disprove this candidate did not."
      : `However, the evidence does not uniquely establish the location${uncertain[0] ? ": " + uncertain[0].replace(/^⚠ /, "").replace(/\.$/, "") : ""}.`,
  );
  return {
    candidateId: lead.id,
    headline: `Possible location: ${place}`,
    confidence: lead.confidence,
    reasons: supports.slice(0, 6).map((e) => e.statement),
    uncertainties: uncertain,
    explanation: parts.join(" "),
    generatedBy: "rules",
    createdAt: created,
    nextSteps: [
      ...(lead.signals.visual === null ? ["Compare the image against reference photos of the candidate (Compare tab)."] : []),
      ...(imageDateHints(inv).length ? [] : ["Add a note with the approximate year the photo was taken to test the timeline."]),
      ...(alts.length ? [`Review the alternatives: ${alts.map((a) => a.name).join(", ")}.`] : []),
      "Open the sources panel and check the primary records behind each claim.",
    ],
  };
}
