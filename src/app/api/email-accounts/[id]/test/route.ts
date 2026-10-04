import { db } from "@/lib/db";
import { api } from "@/lib/server/api";
import { AppError, describeError } from "@/lib/server/errors";
import { providerFor } from "@/lib/server/email/providers";

/** Verifies the connection without sending to a third party (sends to the account's own address). */
export const POST = api({ permission: "integrations.manage" }, async (_req, ctx, p) => {
  const acc = await db.emailAccount.findFirst({ where: { id: p.id, workspaceId: ctx.workspace.id } });
  if (!acc) throw new AppError("NOT_FOUND", "Email account not found.");
  try {
    await providerFor(acc).send({ to: acc.emailAddress, subject: "WebScout AI connection test", text: "This is a test message confirming WebScout AI can send from this account. No action needed." });
    await db.emailAccount.update({ where: { id: acc.id }, data: { status: "CONNECTED", lastError: null } });
    return { ok: true, message: acc.provider === "SANDBOX" ? "Sandbox OK (nothing delivered)." : `Test email sent to ${acc.emailAddress}.` };
  } catch (e) {
    await db.emailAccount.update({ where: { id: acc.id }, data: { status: "ERROR", lastError: describeError(e).slice(0, 500) } });
    return { ok: false, error: describeError(e) };
  }
});
