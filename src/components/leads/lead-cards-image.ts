/** Draws lead "business cards" onto a canvas and returns PNG blobs (one per sheet of up to CARDS_PER_IMAGE leads). */

export type LeadCardData = {
  name: string; type: string; category: string | null; city: string | null; description: string; services: string[];
  address: string | null; phone: string | null; email: string | null; website: string | null;
  rating: number | null; reviewCount: number | null; websiteLabel: string; opportunityScore: number | null; status: string;
};
export type LeadCardsPayload = { agency: string; title: string; scope: string; total: number; generatedAt: string; leads: LeadCardData[] };

export const CARDS_PER_IMAGE = 40;
const SCALE = 2;
const W = 1240;
const PAD = 28;
const GAP = 20;
const CARD_W = (W - PAD * 2 - GAP) / 2;
const INNER = 22;
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const C = { bg: "#f3f4f6", card: "#ffffff", ink: "#111827", muted: "#6b7280", faint: "#9ca3af", line: "#e5e7eb", accent: "#4f46e5", soft: "#eef2ff", chip: "#f3f4f6" };
const tone = (n: number) => (n >= 70 ? { bg: "#d1fae5", fg: "#065f46" } : n >= 45 ? { bg: "#fef3c7", fg: "#92400e" } : { bg: "#fee2e2", fg: "#991b1b" });

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (line && lines.length === maxLines) {
    let last = lines[maxLines - 1]!;
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

type Laid = { lead: LeadCardData; desc: string[]; services: string[]; contact: [string, string[]][]; height: number };

function layout(ctx: CanvasRenderingContext2D, lead: LeadCardData): Laid {
  const textW = CARD_W - INNER * 2;
  ctx.font = `15px ${FONT}`;
  const desc = wrap(ctx, lead.description, textW, 4);
  ctx.font = `13px ${FONT}`;
  const services = lead.services.length ? wrap(ctx, lead.services.join("  ·  "), textW - 70, 2) : [];
  const contact: [string, string[]][] = [];
  const add = (label: string, v: string | null, lines = 1) => { if (v) contact.push([label, wrap(ctx, v, textW - 80, lines)]); };
  add("Address", lead.address, 2);
  add("Phone", lead.phone);
  add("Email", lead.email);
  add("Website", lead.website ? lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "No website");
  const contactLines = contact.reduce((n, [, l]) => n + l.length, 0);
  const height = INNER + 28 + 24 + 14 + desc.length * 21 + (services.length ? 10 + services.length * 18 : 0) + 18 + contactLines * 19 + 14 + 26 + INNER;
  return { lead, desc, services, contact, height };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCard(ctx: CanvasRenderingContext2D, c: Laid, x: number, y: number, h: number) {
  const l = c.lead;
  ctx.save();
  ctx.shadowColor = "rgba(17,24,39,0.08)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, CARD_W, h, 14);
  ctx.fillStyle = C.card;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = C.accent;
  roundRect(ctx, x, y, 6, h, 3);
  ctx.fill();

  const left = x + INNER;
  const textW = CARD_W - INNER * 2;
  let cy = y + INNER;
  ctx.textBaseline = "top";

  // Opportunity badge (top right)
  let badgeW = 0;
  if (l.opportunityScore != null) {
    const t = tone(l.opportunityScore);
    const label = `${l.opportunityScore}/100`;
    ctx.font = `bold 13px ${FONT}`;
    badgeW = ctx.measureText(label).width + 20;
    roundRect(ctx, x + CARD_W - INNER - badgeW, cy, badgeW, 24, 12);
    ctx.fillStyle = t.bg;
    ctx.fill();
    ctx.fillStyle = t.fg;
    ctx.fillText(label, x + CARD_W - INNER - badgeW + 10, cy + 5);
  }
  ctx.font = `bold 21px ${FONT}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(wrap(ctx, l.name, textW - badgeW - 12, 1)[0] ?? "", left, cy);
  cy += 28;

  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = C.muted;
  const sub = [l.category ? l.category.replace(/^\w/, (s) => s.toUpperCase()) : l.type, l.city, l.rating != null ? `★ ${l.rating.toFixed(1)} (${l.reviewCount ?? 0} reviews)` : null].filter(Boolean).join("  ·  ");
  ctx.fillText(wrap(ctx, sub, textW, 1)[0] ?? "", left, cy);
  cy += 24;

  ctx.font = `bold 11px ${FONT}`;
  ctx.fillStyle = C.accent;
  ctx.fillText("WHAT THEY DO", left, cy);
  cy += 14;
  ctx.font = `15px ${FONT}`;
  ctx.fillStyle = C.ink;
  for (const line of c.desc) { ctx.fillText(line, left, cy); cy += 21; }

  if (c.services.length) {
    cy += 10;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText("SERVICES", left, cy + 2);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = C.ink;
    for (const line of c.services) { ctx.fillText(line, left + 70, cy); cy += 18; }
  }

  cy += 8;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, cy + 0.5);
  ctx.lineTo(left + textW, cy + 0.5);
  ctx.stroke();
  cy += 10;

  for (const [label, lines] of c.contact) {
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = C.faint;
    ctx.fillText(label.toUpperCase(), left, cy + 2);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = label === "Website" && l.website ? C.accent : label === "Website" ? C.faint : C.ink;
    for (const line of lines) { ctx.fillText(line, left + 80, cy); cy += 19; }
  }

  // Footer chips
  const site = !l.websiteLabel || l.websiteLabel === "Unknown" ? "Website not checked yet" : /website/i.test(l.websiteLabel) ? l.websiteLabel : `Website: ${l.websiteLabel}`;
  const chips = [site, l.status];
  let cx = left;
  const fy = y + h - INNER - 22;
  ctx.font = `12px ${FONT}`;
  for (const chip of chips) {
    const w = ctx.measureText(chip).width + 18;
    roundRect(ctx, cx, fy, w, 22, 11);
    ctx.fillStyle = chip === l.status ? C.soft : C.chip;
    ctx.fill();
    ctx.fillStyle = chip === l.status ? C.accent : C.muted;
    ctx.fillText(chip, cx + 9, fy + 5);
    cx += w + 8;
  }
}

export async function renderLeadCards(data: LeadCardsPayload): Promise<Blob[]> {
  const measure = document.createElement("canvas").getContext("2d")!;
  const sheets: LeadCardData[][] = [];
  for (let i = 0; i < data.leads.length; i += CARDS_PER_IMAGE) sheets.push(data.leads.slice(i, i + CARDS_PER_IMAGE));
  const blobs: Blob[] = [];
  for (const [si, sheet] of sheets.entries()) {
    const laid = sheet.map((l) => layout(measure, l));
    const rows: number[] = [];
    for (let i = 0; i < laid.length; i += 2) rows.push(Math.max(laid[i]!.height, laid[i + 1]?.height ?? 0));
    const HEADER = 120;
    const height = HEADER + rows.reduce((s, h) => s + h + GAP, 0) + PAD;
    const canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, height);

    ctx.fillStyle = C.accent;
    ctx.fillRect(0, 0, W, 6);
    ctx.textBaseline = "top";
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(data.agency || "WebScout AI", PAD, 26);
    ctx.font = `bold 32px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(`${data.title}${sheets.length > 1 ? ` (${si + 1} of ${sheets.length})` : ""}`, PAD, 46);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.muted;
    const shown = data.leads.length < data.total ? `${data.leads.length} of ${data.total} leads (highest opportunity first)` : `${data.leads.length} leads`;
    ctx.fillText(`${shown}  ·  ${data.scope}  ·  ${new Date(data.generatedAt).toLocaleDateString()}`, PAD, 88);

    let y = HEADER;
    rows.forEach((rh, r) => {
      drawCard(ctx, laid[r * 2]!, PAD, y, rh);
      if (laid[r * 2 + 1]) drawCard(ctx, laid[r * 2 + 1]!, PAD + CARD_W + GAP, y, rh);
      y += rh + GAP;
    });
    blobs.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not create the image."))), "image/png")));
  }
  return blobs;
}
