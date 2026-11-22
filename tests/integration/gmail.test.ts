import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/server/crypto";
import { sendEmail } from "@/lib/server/email/send";
import { syncAccount } from "@/lib/server/email/inbound";
import { base64url, fromBase64url } from "@/lib/server/email/mime";
import { makeWorkspace, noAi } from "../helpers";

describe("Gmail provider (OAuth, HTTP mocked)", () => {
  it("refreshes an expired token, sends RFC 822 with threading, then syncs and matches the reply", async () => {
    noAi();
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const { ws, owner } = await makeWorkspace({ sandbox: false });
    const acc = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "GMAIL", emailAddress: "alex@gmail.test", accessTokenEncrypted: encryptSecret("old"), refreshTokenEncrypted: encryptSecret("refresh-1"), tokenExpiresAt: new Date(Date.now() - 1000), lastSyncAt: new Date(Date.now() - 3600_000) } });
    const b = await db.business.create({ data: { workspaceId: ws.id, name: "ABC", normalizedName: "abc", email: "owner@abc.test" } });
    let sentRaw = "";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u === "https://oauth2.googleapis.com/token") {
        expect(String(init!.body)).toContain("refresh_token=refresh-1");
        return new Response(JSON.stringify({ access_token: "new-token", expires_in: 3600 }), { status: 200 });
      }
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer new-token");
      if (u.endsWith("/messages/send")) {
        sentRaw = fromBase64url(JSON.parse(String(init!.body)).raw);
        return new Response(JSON.stringify({ id: "g-1", threadId: "t-1" }), { status: 200 });
      }
      if (u.includes("/messages?q=")) return new Response(JSON.stringify({ messages: [{ id: "g-2", threadId: "t-1" }] }), { status: 200 });
      if (u.includes("/messages/g-2")) {
        const msgId = sentRaw.match(/Message-ID: (<[^>]+>)/)![1];
        return new Response(JSON.stringify({ id: "g-2", threadId: "t-1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Owner <owner@abc.test>" }, { name: "Subject", value: "Re: Idea" }, { name: "In-Reply-To", value: msgId }, { name: "Message-ID", value: "<reply@abc.test>" }], mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: base64url("Interested — what would it cost?\n\nOn Mon, Alex wrote:\n> hi") } }] } }), { status: 200 });
      }
      throw new Error(`unexpected ${u}`);
    });
    const sent = await sendEmail({ workspaceId: ws.id, userId: owner.id, to: "owner@abc.test", subject: "Idea", body: "Hello", kind: "OUTREACH", businessId: b.id });
    expect(sent.message.providerThreadId).toBe("t-1");
    expect(sentRaw).toMatch(/^From: alex@gmail.test/m);
    expect(sentRaw).toMatch(/^Message-ID: <.+@gmail\.test>/m);
    expect(decryptSecret((await db.emailAccount.findUniqueOrThrow({ where: { id: acc.id } })).accessTokenEncrypted!)).toBe("new-token");
    const r = await syncAccount(await db.emailAccount.findUniqueOrThrow({ where: { id: acc.id } }));
    expect(r).toMatchObject({ fetched: 1, ingested: 1, filtered: 0 });
    const inbound = await db.emailMessage.findFirstOrThrow({ where: { workspaceId: ws.id, direction: "INBOUND" } });
    expect(inbound.conversationId).toBe(sent.conversationId);
    expect(inbound.fromAddress).toBe("owner@abc.test");
    spy.mockRestore();
  });

  it("stays connected when Gmail says 'quota exceeded' during an inbox check (it's a slow-down, not a disconnect)", async () => {
    const { ws } = await makeWorkspace({ sandbox: false });
    const acc = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "GMAIL", emailAddress: "q@gmail.test", accessTokenEncrypted: encryptSecret("tok"), refreshTokenEncrypted: encryptSecret("r"), tokenExpiresAt: new Date(Date.now() + 3600_000), lastSyncAt: new Date("2026-01-01") } });
    const quota = { error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'", errors: [{ reason: "rateLimitExceeded" }] } };
    let listQuery = "";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/messages?q=")) {
        listQuery = decodeURIComponent(u);
        return new Response(JSON.stringify({ messages: [{ id: "m1" }, { id: "m2" }] }), { status: 200 });
      }
      if (u.includes("/messages/m2")) return new Response(JSON.stringify({ id: "m2", threadId: "t", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "a@b.test" }, { name: "Subject", value: "hi" }], mimeType: "text/plain", body: { data: base64url("hello") } } }), { status: 200 });
      return new Response(JSON.stringify(quota), { status: 403 });
    });
    // m2 (oldest first after reverse) arrives, then m1 hits the quota: keep m2, don't throw, don't disconnect.
    const r = await syncAccount(acc);
    expect(r.fetched).toBe(1);
    const after = Number(listQuery.match(/after:(\d+)/)![1]) * 1000;
    expect(after).toBeGreaterThan(Date.now() - 4 * 86400_000); // never catches up further than ~3 days
    expect((await db.emailAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe("CONNECTED");
    // A quota error with nothing fetched is reported as a slow-down, never as revoked access.
    spy.mockResolvedValue(new Response(JSON.stringify(quota), { status: 403 }));
    await expect(syncAccount(acc)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    spy.mockRestore();
  });

  it("sends without a cap when the daily and hourly limits are 0", async () => {
    const { ws, owner } = await makeWorkspace();
    await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { maxEmailsPerDay: 0, maxEmailsPerHour: 0, minMinutesBetweenSends: 0 } });
    for (let i = 0; i < 3; i++) await sendEmail({ workspaceId: ws.id, userId: owner.id, to: `x${i}@b.test`, subject: "s", body: "b", kind: "REPLY" });
    expect(await db.emailMessage.count({ where: { workspaceId: ws.id, status: "SENT" } })).toBe(3);
  });

  it("marks the account as needing reconnection when refresh fails", async () => {
    const { ws, owner } = await makeWorkspace({ sandbox: false });
    const acc = await db.emailAccount.create({ data: { workspaceId: ws.id, provider: "GMAIL", emailAddress: "x@gmail.test", refreshTokenEncrypted: encryptSecret("revoked") } });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(sendEmail({ workspaceId: ws.id, userId: owner.id, to: "a@b.test", subject: "s", body: "b", kind: "REPLY" })).rejects.toThrow(/Reconnect Gmail/);
    expect((await db.emailAccount.findUniqueOrThrow({ where: { id: acc.id } })).status).toBe("ERROR");
    spy.mockRestore();
  });
});
