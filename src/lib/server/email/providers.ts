import "../guard";
import type { EmailAccount } from "@prisma/client";
import { db } from "../../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { env } from "../env";
import { AppError, fetchWithTimeout } from "../errors";
import { base64url, buildRfc822, formatAddress, fromBase64url, htmlToText, makeMessageId } from "./mime";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
  providerThreadId?: string | null;
  replyToOverride?: string | null;
};
export type SendResult = { providerMessageId: string; rfcMessageId: string; providerThreadId: string | null };

export type InboundEmail = {
  providerMessageId: string;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  providerThreadId: string | null;
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  receivedAt: Date;
  mailboxHash?: string | null;
  isAutoReply?: boolean;
};

export interface EmailProviderClient {
  send(msg: OutgoingEmail): Promise<SendResult>;
  /** Fetch new inbound messages (polling providers). Push-based providers return []. */
  fetchInbound(): Promise<InboundEmail[]>;
}

// Test hook: lets integration tests replace provider network calls.
let providerOverride: ((acc: EmailAccount) => EmailProviderClient | null) | null = null;
export function setEmailProviderOverrideForTests(fn: typeof providerOverride) {
  providerOverride = fn;
}

export function providerFor(account: EmailAccount): EmailProviderClient {
  const o = providerOverride?.(account);
  if (o) return o;
  if (account.provider === "GMAIL") return new GmailProvider(account);
  if (account.provider === "POSTMARK") return new PostmarkProvider(account);
  if (account.provider === "SANDBOX") {
    if (!env.sandboxEmailEnabled()) throw new AppError("NOT_CONFIGURED", "The email sandbox is disabled on this server. Connect a real email provider.");
    return new SandboxProvider(account);
  }
  throw new AppError("NOT_CONFIGURED", "Unsupported email provider.");
}

const fromHeader = (a: EmailAccount) => formatAddress(a.emailAddress, a.displayName || null);
const domainOf = (email: string) => email.split("@")[1] ?? "webscout.local";

// ───────────────────────── Gmail (OAuth 2.0, official API) ─────────────────────────

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];

class GmailProvider implements EmailProviderClient {
  constructor(private account: EmailAccount) {}

  private async token(): Promise<string> {
    const a = this.account;
    if (a.accessTokenEncrypted && a.tokenExpiresAt && a.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptSecret(a.accessTokenEncrypted);
    if (!a.refreshTokenEncrypted) throw new AppError("INVALID_CREDENTIALS", "Gmail connection expired. Reconnect Gmail in Settings → Email.");
    const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      service: "Google OAuth",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.googleClientId(), client_secret: env.googleClientSecret(), refresh_token: decryptSecret(a.refreshTokenEncrypted), grant_type: "refresh_token" }),
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      await db.emailAccount.update({ where: { id: a.id }, data: { status: "ERROR", lastError: `Token refresh failed: ${data.error_description ?? data.error ?? res.status}` } });
      throw new AppError("INVALID_CREDENTIALS", "Gmail access was revoked or expired. Reconnect Gmail in Settings → Email.");
    }
    const expires = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
    this.account = await db.emailAccount.update({ where: { id: a.id }, data: { accessTokenEncrypted: encryptSecret(data.access_token), tokenExpiresAt: expires, status: "CONNECTED", lastError: null } });
    return data.access_token;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    const res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...init,
      service: "Gmail",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new AppError("INVALID_CREDENTIALS", `Gmail rejected the request: ${msg}`);
      if (res.status === 429) throw new AppError("QUOTA_EXCEEDED", `Gmail sending/API quota reached: ${msg}`);
      throw new AppError("UPSTREAM_ERROR", `Gmail error: ${msg}`);
    }
    return data;
  }

  async send(msg: OutgoingEmail): Promise<SendResult> {
    const messageId = makeMessageId(domainOf(this.account.emailAddress));
    const raw = buildRfc822({
      from: fromHeader(this.account),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      messageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      replyTo: msg.replyToOverride ?? (this.account.replyTo || null),
    });
    const data = await this.api<{ id: string; threadId: string }>("messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: base64url(raw), ...(msg.providerThreadId ? { threadId: msg.providerThreadId } : {}) }),
    });
    return { providerMessageId: data.id, rfcMessageId: messageId, providerThreadId: data.threadId };
  }

  async fetchInbound(): Promise<InboundEmail[]> {
    const since = this.account.lastSyncAt ?? new Date(Date.now() - 3 * 86400_000);
    const after = Math.floor((since.getTime() - 3600_000) / 1000);
    const list = await this.api<{ messages?: { id: string; threadId: string }[] }>(`messages?q=${encodeURIComponent(`in:inbox after:${after} -from:me`)}&maxResults=50`);
    const out: InboundEmail[] = [];
    for (const m of list.messages ?? []) {
      const exists = await db.emailMessage.findFirst({ where: { workspaceId: this.account.workspaceId, providerMessageId: m.id }, select: { id: true } });
      if (exists) continue;
      const full = await this.api<GmailMessage>(`messages/${m.id}?format=full`);
      out.push(parseGmail(full));
    }
    return out;
  }
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
type GmailMessage = { id: string; threadId: string; internalDate?: string; payload: GmailPart };

function parseGmail(m: GmailMessage): InboundEmail {
  const headers = new Map((m.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));
  let text = "";
  let html: string | null = null;
  const walk = (p: GmailPart) => {
    if (p.mimeType === "text/plain" && p.body?.data && !text) text = fromBase64url(p.body.data);
    if (p.mimeType === "text/html" && p.body?.data && !html) html = fromBase64url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  if (!text && html) text = htmlToText(html);
  const from = headers.get("from") ?? "";
  const fm = from.match(/<([^>]+)>/);
  return {
    providerMessageId: m.id,
    rfcMessageId: headers.get("message-id") ?? null,
    inReplyTo: headers.get("in-reply-to") ?? null,
    references: headers.get("references") ?? null,
    providerThreadId: m.threadId,
    from: (fm ? fm[1]! : from).trim().toLowerCase(),
    fromName: fm ? from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || null : null,
    to: headers.get("to") ?? "",
    subject: headers.get("subject") ?? "(no subject)",
    text,
    html,
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
    isAutoReply: /auto-replied|auto-generated/i.test(headers.get("auto-submitted") ?? "") || Boolean(headers.get("x-autoreply")),
  };
}

// ───────────────────────── Postmark (API token + inbound webhook) ─────────────────────────

class PostmarkProvider implements EmailProviderClient {
  constructor(private account: EmailAccount) {}
  async send(msg: OutgoingEmail): Promise<SendResult> {
    if (!this.account.apiTokenEncrypted) throw new AppError("NOT_CONFIGURED", "Postmark server token missing. Reconnect Postmark in Settings → Email.");
    const messageId = makeMessageId(domainOf(this.account.emailAddress));
    const headers = [{ Name: "Message-ID", Value: messageId }];
    if (msg.inReplyTo) headers.push({ Name: "In-Reply-To", Value: msg.inReplyTo });
    if (msg.references) headers.push({ Name: "References", Value: msg.references });
    const res = await fetchWithTimeout("https://api.postmarkapp.com/email", {
      service: "Postmark",
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": decryptSecret(this.account.apiTokenEncrypted) },
      body: JSON.stringify({
        From: fromHeader(this.account),
        To: msg.to,
        Subject: msg.subject,
        TextBody: msg.text,
        ReplyTo: msg.replyToOverride ?? (this.account.replyTo || undefined),
        Headers: headers,
        MessageStream: "outbound",
        TrackOpens: false,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
    if (!res.ok || (data.ErrorCode ?? 0) !== 0) {
      const m = data.Message ?? `HTTP ${res.status}`;
      if (res.status === 401 || data.ErrorCode === 10) throw new AppError("INVALID_CREDENTIALS", `Postmark rejected the server token: ${m}`);
      if (data.ErrorCode === 406) throw new AppError("SUPPRESSED", `Postmark: recipient is inactive (bounced or marked spam previously). ${m}`);
      if (res.status === 429) throw new AppError("RATE_LIMITED", `Postmark rate limit: ${m}`);
      throw new AppError("UPSTREAM_ERROR", `Postmark error: ${m}`);
    }
    return { providerMessageId: data.MessageID!, rfcMessageId: messageId, providerThreadId: null };
  }
  async fetchInbound() {
    return []; // Postmark delivers replies by webhook (/api/webhooks/inbound/postmark/{token}).
  }
}

/** Parses Postmark's inbound webhook JSON. */
export function parsePostmarkInbound(body: Record<string, unknown>): InboundEmail {
  const headers = new Map(((body.Headers as { Name: string; Value: string }[]) ?? []).map((h) => [h.Name.toLowerCase(), h.Value]));
  const fromFull = body.FromFull as { Email?: string; Name?: string } | undefined;
  return {
    providerMessageId: String(body.MessageID ?? ""),
    rfcMessageId: headers.get("message-id") ?? null,
    inReplyTo: headers.get("in-reply-to") ?? null,
    references: headers.get("references") ?? null,
    providerThreadId: null,
    from: String(fromFull?.Email ?? body.From ?? "").toLowerCase(),
    fromName: fromFull?.Name ?? null,
    to: String(body.To ?? ""),
    subject: String(body.Subject ?? "(no subject)"),
    text: String(body.TextBody || (body.HtmlBody ? htmlToText(String(body.HtmlBody)) : "")),
    html: body.HtmlBody ? String(body.HtmlBody) : null,
    receivedAt: body.Date ? new Date(String(body.Date)) : new Date(),
    mailboxHash: body.MailboxHash ? String(body.MailboxHash) : null,
    isAutoReply: /auto-replied|auto-generated/i.test(headers.get("auto-submitted") ?? ""),
  };
}

// ───────────────────────── Sandbox (development only, clearly labelled) ─────────────────────────

class SandboxProvider implements EmailProviderClient {
  constructor(private account: EmailAccount) {}
  async send(): Promise<SendResult> {
    const id = makeMessageId(`sandbox.${domainOf(this.account.emailAddress)}`);
    return { providerMessageId: `sandbox-${id.slice(1, -1)}`, rfcMessageId: id, providerThreadId: null };
  }
  async fetchInbound() {
    return [];
  }
}
