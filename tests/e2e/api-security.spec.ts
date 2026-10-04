import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const H = { Origin: base, "Content-Type": "application/json" };

async function signup(name: string) {
  const ctx = await pwRequest.newContext({ baseURL: base });
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const r = await ctx.post("/api/auth/signup", { headers: H, data: { name, email, password: "correct-horse-42" } });
  expect(r.ok()).toBeTruthy();
  const w = await ctx.post("/api/workspaces", { headers: H, data: { name: `${name} ws` } });
  expect(w.ok()).toBeTruthy();
  await ctx.patch("/api/workspace", { headers: H, data: { onboardingCompleted: true } });
  return { ctx, email };
}

test.describe("API security", () => {
  let a: { ctx: APIRequestContext; email: string };
  let b: { ctx: APIRequestContext; email: string };
  let leadA: string;

  test.beforeAll(async () => {
    a = await signup("alice");
    b = await signup("bob");
    const r = await a.ctx.post("/api/leads", { headers: H, data: { name: "Tenant A Bakery", category: "Bakery" } });
    leadA = (await r.json()).id;
  });

  test("unauthenticated requests are rejected", async () => {
    const anon = await pwRequest.newContext({ baseURL: base });
    expect((await anon.get("/api/leads")).status()).toBe(401);
    expect((await anon.post("/api/leads", { headers: H, data: { name: "x" } })).status()).toBe(401);
  });

  test("CSRF: cross-site origins are blocked", async () => {
    const r = await a.ctx.post("/api/leads", { headers: { ...H, Origin: "https://evil.example" }, data: { name: "x" } });
    expect(r.status()).toBe(403);
  });

  test("tenant isolation: another workspace cannot read or modify a lead", async () => {
    expect((await b.ctx.patch(`/api/leads/${leadA}`, { headers: H, data: { name: "hacked" } })).status()).toBe(404);
    expect((await b.ctx.post(`/api/leads/${leadA}/status`, { headers: H, data: { status: "WON" } })).status()).toBe(404);
    const list = await (await b.ctx.get("/api/leads")).json();
    expect(list.rows.find((r: { id: string }) => r.id === leadA)).toBeUndefined();
    const s = await (await b.ctx.get("/api/search?q=Tenant")).json();
    expect(s.businesses).toHaveLength(0);
  });

  test("roles: a viewer cannot edit, send, export or change integrations", async () => {
    const inv = await a.ctx.post("/api/workspace/members", { headers: H, data: { email: b.email, role: "VIEWER" } });
    const { link } = await inv.json();
    const token = link.split("/invite/")[1];
    expect((await b.ctx.post("/api/invitations/accept", { headers: H, data: { token } })).ok()).toBeTruthy();
    const me = await (await b.ctx.get("/api/me")).json();
    const wsA = me.workspaces.find((w: { role: string }) => w.role === "VIEWER");
    await b.ctx.post("/api/workspaces/switch", { headers: H, data: { workspaceId: wsA.id } });
    expect((await b.ctx.get("/api/leads")).status()).toBe(200);
    expect((await b.ctx.patch(`/api/leads/${leadA}`, { headers: H, data: { name: "x" } })).status()).toBe(403);
    expect((await b.ctx.get("/api/leads/export")).status()).toBe(403);
    expect((await b.ctx.put("/api/settings/integrations/anthropic", { headers: H, data: { key: "sk-ant-xxxxxxxxxx" } })).status()).toBe(403);
    expect((await b.ctx.patch("/api/settings/automation", { headers: H, data: { automaticReplies: true } })).status()).toBe(403);
    const deny = await b.ctx.patch("/api/settings/compliance", { headers: H, data: { maxEmailsPerDay: 9999 } });
    expect(deny.status()).toBe(403);
    expect((await deny.json()).error.message).toMatch(/viewer/);
  });

  test("secrets are never returned to the browser", async () => {
    const r = await a.ctx.get("/api/settings/integrations");
    const text = await r.text();
    expect(text).not.toMatch(/secretEncrypted|accessToken|refreshToken|apiToken/);
  });

  test("login is rate limited", async () => {
    const ctx = await pwRequest.newContext({ baseURL: base });
    const target = `nobody-${Date.now()}@example.com`;
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await ctx.post("/api/auth/login", { headers: H, data: { email: target, password: "wrong-password-1" } })).status();
    expect(last).toBe(429);
  });

  test("validation errors are specific", async () => {
    const r = await a.ctx.post("/api/discovery", { headers: H, data: { location: "", category: "" } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error.message).toMatch(/location|category/i);
  });
});
