import crypto from "node:crypto";

/** Minimal RFC 5322 helpers used by the Gmail provider and threading logic. */

export function makeMessageId(domain: string) {
  return `<${crypto.randomUUID()}@${domain.replace(/[^a-z0-9.-]/gi, "") || "webscout.local"}>`;
}

function encodeHeader(v: string) {
  return /[^\x20-\x7e]/.test(v) ? `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=` : v;
}

export function formatAddress(email: string, name?: string | null) {
  if (!name) return email;
  return `${encodeHeader(name.replace(/["\\]/g, ""))} <${email}>`;
}

export function buildRfc822(m: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string | null;
  references?: string | null;
  replyTo?: string | null;
  extraHeaders?: Record<string, string>;
}) {
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Message-ID: ${m.messageId}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (m.replyTo) headers.push(`Reply-To: ${m.replyTo}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references) headers.push(`References: ${m.references}`);
  for (const [k, v] of Object.entries(m.extraHeaders ?? {})) headers.push(`${k}: ${v}`);
  const body = Buffer.from(m.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export const base64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromBase64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export function parseAddress(raw: string | null | undefined): { email: string; name: string | null } {
  if (!raw) return { email: "", name: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2]!.trim().toLowerCase(), name: m[1]!.trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

/** Removes quoted history ("On … wrote:", "> " lines, signatures) to isolate the new reply text. */
export function stripQuotedReply(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/i.test(line.trim()) && out.length > 0) break;
    if (/^>/.test(line)) continue;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
