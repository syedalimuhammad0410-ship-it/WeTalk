"use client";
import type { Investigation } from "@/lib/types";
import { imageUrl, proxied } from "./api";

async function toDataUrl(src: string, maxW = 1400): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const { loadImage } = await import("@/lib/vision/image");
    const img = await loadImage(src);
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", 0.86), w: c.width, h: c.height };
  } catch {
    return null;
  }
}

/** Composes a static map from OSM tiles (fetched through the authenticated proxy so the canvas is exportable). */
async function staticMap(lat: number, lng: number, zoom = 14): Promise<string | null> {
  try {
    const { loadImage } = await import("@/lib/vision/image");
    const n = 2 ** zoom;
    const xt = ((lng + 180) / 360) * n;
    const yt = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const W = 768;
    const H = 432;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0a0c0f";
    ctx.fillRect(0, 0, W, H);
    const cx = Math.floor(xt);
    const cy = Math.floor(yt);
    const jobs: Promise<void>[] = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = (((cx + dx) % n) + n) % n;
        const y = cy + dy;
        jobs.push(
          loadImage(proxied(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`))
            .then((im) => ctx.drawImage(im, W / 2 + (cx + dx - xt) * 256, H / 2 + (cy + dy - yt) * 256))
            .catch(() => undefined),
        );
      }
    await Promise.all(jobs);
    ctx.fillStyle = "#ff7a45";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(W - 190, H - 18, 190, 18);
    ctx.fillStyle = "#ccc";
    ctx.font = "11px sans-serif";
    ctx.fillText("© OpenStreetMap contributors", W - 182, H - 5);
    return c.toDataURL("image/jpeg", 0.88);
  } catch {
    return null;
  }
}

export async function exportPdf(inv: Investigation, boardPng?: string | null) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;
  const ink = (r: number, g: number, b: number) => doc.setTextColor(r, g, b);
  const footer = () => {
    doc.setFontSize(8);
    ink(130, 136, 144);
    doc.text(`TRACE investigation report · ${inv.title.slice(0, 60)} · page ${doc.getNumberOfPages()}`, M, PH - 24);
  };
  const need = (h: number) => {
    if (y + h > PH - 50) {
      footer();
      doc.addPage();
      y = M;
    }
  };
  const h1 = (t: string) => {
    need(40);
    y += 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    ink(20, 24, 30);
    doc.text(t.toUpperCase(), M, y);
    doc.setDrawColor(89, 212, 232);
    doc.setLineWidth(1.2);
    doc.line(M, y + 6, M + 40, y + 6);
    y += 24;
  };
  const para = (t: string, size = 10, color: [number, number, number] = [40, 44, 52], indent = 0) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    ink(...color);
    const lines = doc.splitTextToSize(t, PW - 2 * M - indent);
    for (const l of lines) {
      need(size * 1.4);
      doc.text(l, M + indent, y);
      y += size * 1.4;
    }
  };

  // ---- cover
  doc.setFillColor(8, 9, 11);
  doc.rect(0, 0, PW, PH, "F");
  doc.setTextColor(89, 212, 232);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TRACE  //  INVESTIGATION REPORT", M, 70);
  doc.setTextColor(238, 241, 244);
  doc.setFontSize(26);
  doc.text(doc.splitTextToSize(inv.title, PW - 2 * M), M, 110);
  const c = inv.conclusion;
  doc.setFontSize(15);
  doc.setTextColor(255, 122, 69);
  doc.text(doc.splitTextToSize(c?.headline || "No conclusion", PW - 2 * M), M, 170);
  doc.setFontSize(10);
  doc.setTextColor(154, 163, 173);
  doc.text(`Confidence: ${c?.confidence || "—"}   ·   Mode: ${inv.mode}   ·   Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, M, 205);
  if (inv.demo) doc.text("DEMO — public sample data from Wikimedia Commons", M, 220);
  const cover = inv.images[0] && (await toDataUrl(imageUrl(inv.images[0].key)));
  if (cover) {
    const w = PW - 2 * M;
    const h = Math.min(420, (w * cover.h) / cover.w);
    doc.addImage(cover.data, "JPEG", M, 245, (h * cover.w) / cover.h, h);
    doc.setFontSize(8);
    doc.text(`Original image: ${inv.images[0].name}${inv.images[0].demoSource ? ` — ${inv.images[0].demoSource.license}, ${inv.images[0].demoSource.url}` : ""}`.slice(0, 160), M, 245 + h + 14);
  }
  doc.setFontSize(8);
  doc.setTextColor(100, 109, 119);
  doc.text("Confidence levels are qualitative. Direct evidence, indirect evidence, inference and user-provided information are distinguished throughout.", M, PH - 40);
  doc.addPage();
  y = M;

  // ---- result
  h1("Result");
  para(c?.headline || "No conclusion", 13, [20, 24, 30]);
  para(`Confidence: ${c?.confidence || "—"}`, 10, [27, 142, 163]);
  y += 4;
  para(c?.explanation || "", 10);
  para(c?.generatedBy === "ai" ? "(Explanation written by AI from stored evidence only.)" : "(Rules-based explanation.)", 8, [120, 126, 134]);
  if (c?.reasons.length) {
    y += 6;
    para("Why", 11, [20, 24, 30]);
    c.reasons.forEach((r) => para(`+  ${r}`, 9.5, [40, 44, 52], 8));
  }
  if (c?.uncertainties.length) {
    y += 6;
    para("Uncertainty", 11, [20, 24, 30]);
    c.uncertainties.forEach((r) => para(`!  ${r.replace(/^⚠ /, "")}`, 9.5, [150, 100, 20], 8));
  }
  const lead = inv.candidates.find((x) => x.id === c?.candidateId);
  const loc = lead && inv.locations.find((l) => l.id === lead.locationId);
  if (loc) {
    const map = await staticMap(loc.lat, loc.lng, 15);
    h1("Map");
    para(`${loc.name} — ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.address ? ` — ${loc.address}` : ""}`, 9.5);
    if (map) {
      need(270);
      doc.addImage(map, "JPEG", M, y, PW - 2 * M, ((PW - 2 * M) * 432) / 768);
      y += ((PW - 2 * M) * 432) / 768 + 10;
    }
  }

  // ---- clues
  h1("Detected clues");
  inv.clues
    .filter((x) => !x.ignored)
    .slice(0, 50)
    .forEach((cl) => para(`[${cl.type.toUpperCase()}] ${cl.value}  — ${cl.engine}${cl.label.includes("uncertain") ? " (uncertain)" : ""}`, 9, [40, 44, 52], 4));

  // ---- timeline
  if (inv.timeline.length) {
    h1("Timeline");
    [...inv.timeline].sort((a, b) => a.year - b.year).forEach((t) => para(`${t.date}   ${t.label}${t.userProvided ? " (user-provided)" : ""}`, 9.5, [40, 44, 52], 4));
  }

  // ---- candidates & evidence
  h1("Candidate locations & evidence");
  inv.candidates.forEach((cd, i) => {
    need(40);
    para(`#${i + 1}  ${cd.name}${cd.city ? `, ${cd.city}` : ""} — ${cd.status}, ${cd.confidence} confidence`, 11, cd.status === "leading" ? [200, 80, 30] : [20, 24, 30]);
    if (cd.rejectionReason) para(`Rejected: ${cd.rejectionReason}`, 9, [180, 50, 60], 8);
    inv.evidence.filter((e) => e.candidateId === cd.id).forEach((e) => para(`[${e.kind} · ${e.polarity} · ${e.strength}] ${e.statement}`, 9, [55, 60, 68], 8));
    cd.falsification?.forEach((f) => para(`Disproof check — ${f.outcome.toUpperCase()}: ${f.question} ${f.result}`, 8.5, [90, 96, 104], 8));
    y += 6;
  });
  if (inv.contradictions.length) {
    h1("Contradictions");
    inv.contradictions.forEach((x) => para(`${x.subject} — ${x.property}: ${x.claims.map((cl) => cl.value).join(" vs ")}. ${x.note}`, 9.5, [150, 100, 20]));
  }
  if (boardPng) {
    h1("Evidence board");
    const img = await toDataUrl(boardPng, 1800);
    if (img) {
      const w = PW - 2 * M;
      const h = (w * img.h) / img.w;
      need(Math.min(h, PH - 120));
      doc.addImage(img.data, "JPEG", M, y, w, Math.min(h, PH - 120));
      y += Math.min(h, PH - 120) + 10;
    }
  }
  if (inv.notes.length) {
    h1("Notes (user-provided)");
    inv.notes.forEach((n) => para(`• ${n.text}`, 9.5));
  }
  h1("Sources");
  inv.sources.forEach((s, i) =>
    para(`${i + 1}. ${s.title} — ${s.publisher}. ${s.url}  (accessed ${s.accessedAt.slice(0, 10)}; ${s.category}; ${s.reliability.tier}${s.verified ? "" : "; not fetched/unverified"}${s.usedInReasoning ? "; used in reasoning" : ""})`, 8, [55, 60, 68]),
  );
  h1("Search queries");
  inv.queries.forEach((q) => para(`[${q.kind} · ${q.provider} · ${q.status}] ${q.text}`, 8, [80, 86, 94]));
  footer();
  doc.save(`${inv.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60) || "investigation"}.pdf`);
}
