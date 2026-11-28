import "../guard";
import type { EmailAccount, MessageKind, Prisma } from "@prisma/client";
import { db } from "../../db";
import { AppError } from "../errors";

/**
 * Several inboxes (up to 5 Gmail accounts) can send for one workspace.
 * - New outreach goes from the inbox that has sent the least in the last 24 hours and still has room
 *   under its own daily cap.
 * - A conversation always continues from the inbox it started in, so a thread never jumps mailboxes.
 * - An inbox Gmail asked to slow down rests (restUntil) while the others carry on.
 */
export const MAX_GMAIL_ACCOUNTS = 5;
const DAY = 86400_000;
const COLD: MessageKind[] = ["OUTREACH", "FOLLOW_UP"];
type Client = Prisma.TransactionClient | typeof db;

export type Inbox = {
  account: EmailAccount;
  /** Emails sent (or being sent) from it in the last 24 hours. */
  sent: number;
  /** Has room for another cold email right now. */
  open: boolean;
  /** When it can take the next cold email (now, if open). */
  opensAt: Date;
  resting: boolean;
};

export async function listInboxes(workspaceId: string, client: Client = db): Promise<Inbox[]> {
  const accounts = await client.emailAccount.findMany({ where: { workspaceId, status: { not: "DISCONNECTED" } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!accounts.length) return [];
  const now = Date.now();
  const recent = await client.emailMessage.findMany({
    where: { workspaceId, direction: "OUTBOUND", status: { in: ["SENT", "QUEUED"] }, emailAccountId: { in: accounts.map((a) => a.id) }, createdAt: { gte: new Date(now - DAY) } },
    orderBy: { createdAt: "desc" },
    select: { emailAccountId: true, createdAt: true },
  });
  return accounts.map((account) => {
    const times = recent.filter((m) => m.emailAccountId === account.id).map((m) => m.createdAt.getTime());
    const full = account.dailyLimit > 0 && times.length >= account.dailyLimit;
    const resting = Boolean(account.restUntil && account.restUntil.getTime() > now);
    // At its cap, the next slot opens once the oldest email still counting toward it is 24 hours old.
    const capOpens = full ? times[account.dailyLimit - 1]! + DAY + 1000 : now;
    const opensAt = Math.max(capOpens, resting ? account.restUntil!.getTime() : now);
    return { account, sent: times.length, open: !full && !resting, opensAt: new Date(opensAt), resting };
  });
}

/**
 * Inboxes new outreach may go from: switched on for sending; real inboxes over the sandbox; and healthy
 * ones only, unless none is (a broken one is then tried, in case the problem has cleared).
 */
export function sendingPool(list: Inbox[]) {
  const on = list.filter((i) => i.account.sendingEnabled);
  const real = on.filter((i) => i.account.provider !== "SANDBOX");
  const base = real.length ? real : on;
  const healthy = base.filter((i) => i.account.status === "CONNECTED");
  return healthy.length ? healthy : base;
}

export function waitText(ms: number) {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? "about a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The soonest an inbox in `pool` can send again, and why none can right now. */
export function nextOpening(pool: Inbox[]) {
  const next = pool.reduce((a, b) => (a.opensAt < b.opensAt ? a : b));
  const ms = Math.max(1000, next.opensAt.getTime() - Date.now());
  const one = (i: Inbox) => (i.resting ? `${i.account.emailAddress} is resting after Gmail asked it to slow down` : `${i.account.emailAddress} has sent its ${i.account.dailyLimit} emails for today`);
  const why = pool.length === 1 ? one(next) : `All ${pool.length} inboxes have used today's caps or are resting`;
  return { ms, why, inbox: next };
}

/**
 * Which inbox sends this email. Pass the transaction client from inside the send lock, so two sends
 * can't both take an inbox's last slot.
 */
export async function pickSendingAccount(workspaceId: string, opts: { kind: MessageKind; boundAccountId?: string | null; client?: Client }): Promise<EmailAccount> {
  const list = await listInboxes(workspaceId, opts.client);
  if (!list.length) throw new AppError("NOT_CONFIGURED", "Connect an email account in Settings → Email to send emails.");
  const cold = COLD.includes(opts.kind);
  const bound = opts.boundAccountId ? list.find((i) => i.account.id === opts.boundAccountId) : undefined;
  if (bound) {
    // Replies always go out; cold email from this inbox waits for room under its cap.
    if (cold && !bound.open) {
      const n = nextOpening([bound]);
      throw new AppError("RATE_LIMITED", `This conversation continues from ${bound.account.emailAddress}, which ${bound.resting ? "is resting after Gmail asked it to slow down" : `has sent its ${bound.account.dailyLimit} emails for today`}. It can send again in ${waitText(n.ms)}. Nothing was sent.`, { retryAfter: Math.ceil(n.ms / 1000) });
    }
    return bound.account;
  }
  const pool = sendingPool(list);
  if (!pool.length) {
    if (!cold) return list[0]!.account;
    throw new AppError("NOT_CONFIGURED", "Every inbox has “Send new emails” switched off. Turn one on in Settings → Email.");
  }
  if (!cold) return pool[0]!.account;
  const open = pool.filter((i) => i.open);
  if (!open.length) {
    const n = nextOpening(pool);
    throw new AppError("RATE_LIMITED", `${n.why}. The next free slot is in ${waitText(n.ms)}. Nothing was sent.`, { retryAfter: Math.ceil(n.ms / 1000) });
  }
  // Least used first; ties keep the main inbox first (the list is ordered main inbox, then oldest).
  return open.reduce((best, i) => (i.sent < best.sent ? i : best)).account;
}

/** How long an inbox rests after Gmail pushes back: until the time Gmail names, a day for a sending limit, else 30 minutes. */
export function restFor(message: string) {
  const at = /retry after (\d{4}-\d\d-\d\dT[\d:.]+Z)/i.exec(message);
  const until = at ? Date.parse(at[1]!) - Date.now() : NaN;
  if (until > 0) return Math.min(until + 60_000, DAY + 3600_000);
  if (/daily|per day|sending limit|too many messages/i.test(message)) return DAY;
  return 30 * 60_000;
}

/** How many more cold emails the inboxes can send today (null = at least one has no cap). */
export function roomToday(pool: Inbox[]) {
  let room = 0;
  for (const i of pool) {
    if (i.account.dailyLimit === 0) return null;
    if (!i.resting) room += Math.max(0, i.account.dailyLimit - i.sent);
  }
  return room;
}
