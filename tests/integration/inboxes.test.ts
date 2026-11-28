import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/server/email/send";
import { listInboxes, pickSendingAccount, restFor } from "@/lib/server/email/inboxes";
import { emailSetup } from "@/lib/server/email/runs";
import { makeWorkspace } from "../helpers";

async function lead(ws: string, name: string) {
  return db.business.create({ data: { workspaceId: ws, name, normalizedName: name, email: `info@${name}.test`, city: "Toronto" } });
}
const outreach = (ws: string, b: { id: string; email: string | null }) => sendEmail({ workspaceId: ws, userId: null, to: b.email!, subject: "Hello", body: "A short note.", kind: "OUTREACH", businessId: b.id });

describe("several sending inboxes", () => {
  it("takes turns across inboxes and stops each one at its own daily cap", async () => {
    const { ws } = await makeWorkspace();
    await db.emailAccount.updateMany({ where: { workspaceId: ws.id }, data: { dailyLimit: 2 } });
    await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "SANDBOX", emailAddress: "second@studio.test", isDefault: false, dailyLimit: 1 } });
    const from: string[] = [];
    for (const n of ["one", "two", "three"]) from.push((await outreach(ws.id, await lead(ws.id, n))).from);
    // Tie → main inbox; then the least used one with room.
    expect(from).toEqual(["agency@studio.test", "second@studio.test", "agency@studio.test"]);
    await expect(outreach(ws.id, await lead(ws.id, "four"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const setup = await emailSetup(ws.id);
    expect(setup.sender).toBe("2 inboxes, taking turns");
    expect(setup.roomToday).toBe(0);
    // Full inboxes wait for room; they don't block a run (only the missing mailing address does here).
    expect(setup.blockers.map((b) => b.code)).toEqual(["NO_ADDRESS"]);
  });

  it("keeps a conversation in the inbox it started from, and skips inboxes switched off", async () => {
    const { ws } = await makeWorkspace();
    const second = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "SANDBOX", emailAddress: "second@studio.test", isDefault: false } });
    const x = await lead(ws.id, "keep");
    const first = await outreach(ws.id, x);
    expect(first.from).toBe("agency@studio.test");
    // The second inbox is now the least used, but the follow-up stays in the thread's inbox.
    const f = await sendEmail({ workspaceId: ws.id, userId: null, to: x.email!, subject: "Re: Hello", body: "Following up.", kind: "FOLLOW_UP", businessId: x.id, conversationId: first.conversationId });
    expect(f.from).toBe("agency@studio.test");
    expect((await outreach(ws.id, await lead(ws.id, "next"))).from).toBe("second@studio.test");
    await db.emailAccount.update({ where: { id: second.id }, data: { sendingEnabled: false } });
    expect((await outreach(ws.id, await lead(ws.id, "third"))).from).toBe("agency@studio.test");
  });

  it("rests an inbox Gmail asked to slow down and prefers real inboxes over the sandbox", async () => {
    expect(restFor("Gmail asked WebScout to slow down: User-rate limit exceeded. Retry after 2099-01-01T00:00:00.000Z")).toBe(25 * 3600_000);
    expect(restFor("Gmail asked WebScout to slow down: Daily user sending quota exceeded.")).toBe(86400_000);
    expect(restFor("Gmail asked WebScout to slow down: Too many concurrent requests for user.")).toBe(30 * 60_000);
    const { ws } = await makeWorkspace();
    const main = await db.emailAccount.findFirstOrThrow({ where: { workspaceId: ws.id } });
    const a = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "GMAIL", emailAddress: "a@gmail.test", isDefault: false } });
    const b = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "GMAIL", emailAddress: "b@gmail.test", isDefault: false } });
    expect((await pickSendingAccount(ws.id, { kind: "OUTREACH" })).id).toBe(a.id);
    await db.emailAccount.update({ where: { id: a.id }, data: { restUntil: new Date(Date.now() + 3600_000) } });
    expect((await pickSendingAccount(ws.id, { kind: "OUTREACH" })).id).toBe(b.id);
    expect((await listInboxes(ws.id)).find((i) => i.account.id === a.id)?.resting).toBe(true);
    // A broken inbox is skipped (with a warning) while a healthy one remains.
    await db.emailAccount.update({ where: { id: b.id }, data: { status: "ERROR" } });
    await expect(pickSendingAccount(ws.id, { kind: "OUTREACH" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect((await pickSendingAccount(ws.id, { kind: "REPLY", boundAccountId: main.id })).id).toBe(main.id);
  });
});
