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
    expect(r).toEqual({ fetched: 1, ingested: 1 });
    const inbound = await db.emailMessage.findFirstOrThrow({ where: { workspaceId: ws.id, direction: "INBOUND" } });
    expect(inbound.conversationId).toBe(sent.conversationId);
    expect(inbound.fromAddress).toBe("owner@abc.test");
    spy.mockRestore();
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
