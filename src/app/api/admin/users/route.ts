import { z } from "zod";
import { HttpError, readJson, requireOwner, route } from "@/lib/server/api";
import { hashPassword } from "@/lib/auth/password";
import { accountSettings, deleteAccount, getAccount, listAccounts, loginLog, saveAccount, saveAccountSettings } from "@/lib/server/accounts";

/** Owner-only account management. Passwords are never returned — they are stored as one-way hashes. */
export const GET = route(async (_req, { user }) => {
  requireOwner(user);
  return { accounts: await listAccounts(), logins: (await loginLog()).slice(0, 150), settings: await accountSettings() };
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve", "disable", "enable", "delete"]), email: z.string().email() }),
  z.object({ action: z.literal("set-password"), email: z.string().email(), password: z.string().min(8).max(200) }),
  z.object({ action: z.literal("settings"), requireApproval: z.boolean().optional(), allowSignups: z.boolean().optional() }),
]);

export const POST = route(async (req, { user }) => {
  requireOwner(user);
  const b = await readJson(req, Body);
  if (b.action === "settings") {
    await saveAccountSettings({ requireApproval: b.requireApproval, allowSignups: b.allowSignups });
    return { settings: await accountSettings() };
  }
  const a = await getAccount(b.email);
  if (!a) throw new HttpError(404, "Account not found.");
  if (b.action === "delete") await deleteAccount(a.email);
  else {
    if (b.action === "approve" || b.action === "enable") {
      a.status = "active";
      a.approvedAt ||= new Date().toISOString();
    }
    if (b.action === "disable") a.status = "disabled";
    if (b.action === "set-password") a.passwordHash = await hashPassword(b.password);
    await saveAccount(a);
  }
  return { accounts: await listAccounts() };
}, { limit: 60, name: "admin-users" });
