import "server-only";
import { createHash } from "node:crypto";
import { storage } from "./storage";
import { allowedEmails } from "@/lib/auth/session";

/**
 * User accounts. Passwords are stored ONLY as scrypt hashes — nobody (including the
 * owner) can read them. The owner (AUTH_ALLOWED_EMAILS) can approve, disable, delete
 * accounts and set a new password for a user.
 */
export type AccountStatus = "pending" | "active" | "disabled";

export interface Account {
  email: string;
  name: string;
  passwordHash: string;
  status: AccountStatus;
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  loginCount: number;
}

export type PublicAccount = Omit<Account, "passwordHash">;

export interface LoginEvent {
  at: string;
  email: string;
  ok: boolean;
  reason?: string;
  ip: string;
  userAgent: string;
}

const key = (email: string) => `accounts/${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32)}`;
const INDEX = "accounts-index";
const LOG = "login-log";
const SETTINGS = "accounts-settings";

export const isOwner = (email: string) => allowedEmails().includes(email.toLowerCase());

export async function getAccount(email: string): Promise<Account | null> {
  return storage().getJSON<Account>(key(email));
}

export async function saveAccount(a: Account) {
  await storage().setJSON(key(a.email), a);
  const idx = (await storage().getJSON<string[]>(INDEX)) || [];
  if (!idx.includes(a.email)) await storage().setJSON(INDEX, [...idx, a.email]);
}

export async function deleteAccount(email: string) {
  await storage().delete(key(email));
  const idx = (await storage().getJSON<string[]>(INDEX)) || [];
  await storage().setJSON(INDEX, idx.filter((e) => e !== email.toLowerCase()));
}

export async function listAccounts(): Promise<PublicAccount[]> {
  const idx = (await storage().getJSON<string[]>(INDEX)) || [];
  const out: PublicAccount[] = [];
  for (const e of idx) {
    const a = await getAccount(e);
    if (a) {
      const { passwordHash: _h, ...pub } = a;
      void _h;
      out.push(pub);
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function recordLogin(ev: LoginEvent) {
  try {
    const log = (await storage().getJSON<LoginEvent[]>(LOG)) || [];
    await storage().setJSON(LOG, [ev, ...log].slice(0, 300));
  } catch {
    /* best effort */
  }
}

export async function loginLog() {
  return (await storage().getJSON<LoginEvent[]>(LOG)) || [];
}

export async function accountSettings(): Promise<{ requireApproval: boolean; allowSignups: boolean }> {
  return { requireApproval: false, allowSignups: true, ...((await storage().getJSON<object>(SETTINGS)) || {}) };
}

export async function saveAccountSettings(s: Partial<{ requireApproval: boolean; allowSignups: boolean }>) {
  await storage().setJSON(SETTINGS, { ...(await accountSettings()), ...s });
}

/** Is this signed-in email still allowed in? (owner, or an active account) */
export async function isActiveUser(email: string) {
  if (isOwner(email)) return true;
  const a = await getAccount(email);
  return a?.status === "active";
}
