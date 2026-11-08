import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { activatePlan, effectivePlan, getSubscription, handlePayPalEvent, leadAllowance, syncDuePayPalSubscriptions } from "@/lib/server/billing";
import { getPayPalSubscription, paypalPlanId, resetPayPalForTests, verifyPayPalWebhook } from "@/lib/server/paypal";
import { makeWorkspace } from "../helpers";

/** A fake PayPal REST API: products, plans, subscriptions and webhook verification. */
function fakePayPal() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const products: { id: string; name: string }[] = [];
  const plans: { id: string; name: string; status: string; product_id: string; body: unknown }[] = [];
  const subs = new Map<string, Record<string, unknown>>();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/v1/oauth2/token") return String(init?.headers && (init.headers as Record<string, string>).Authorization).includes(Buffer.from("cid:secret").toString("base64")) ? json({ access_token: "tok", expires_in: 3600 }) : json({ error_description: "Client Authentication failed" }, 401);
    if (url.pathname === "/v1/catalogs/products") {
      if (method === "GET") return json({ products });
      const p = { id: `PROD-${products.length + 1}`, name: body.name };
      products.push(p);
      return json(p, 201);
    }
    if (url.pathname === "/v1/billing/plans") {
      if (method === "GET") return json({ plans: plans.filter((p) => p.product_id === url.searchParams.get("product_id")) });
      const p = { id: `P-${plans.length + 1}`, name: body.name, status: body.status, product_id: body.product_id, body };
      plans.push(p);
      return json(p, 201);
    }
    const m = url.pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)(\/cancel)?$/);
    if (m) {
      const s = subs.get(m[1]);
      if (!s) return json({ name: "RESOURCE_NOT_FOUND", message: "The specified resource does not exist." }, 404);
      if (m[2]) {
        s.status = "CANCELLED";
        return new Response(null, { status: 204 });
      }
      return json(s);
    }
    if (url.pathname === "/v1/notifications/verify-webhook-signature") return json({ verification_status: body.transmission_sig === "good-sig" ? "SUCCESS" : "FAILURE" });
    return json({ message: `unexpected ${url.pathname}` }, 500);
  });
  return { calls, products, plans, subs, restore: () => spy.mockRestore() };
}

describe("PayPal subscriptions", () => {
  let pp: ReturnType<typeof fakePayPal>;
  beforeEach(() => {
    vi.stubEnv("PAYPAL_CLIENT_ID", "cid");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_MODE", "sandbox");
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-1");
    resetPayPalForTests();
    pp = fakePayPal();
  });
  afterEach(() => {
    pp.restore();
    vi.unstubAllEnvs();
    resetPayPalForTests();
  });

  it("creates the product and each plan once, then reuses them", async () => {
    const a = await paypalPlanId("STARTER", "MONTHLY");
    const b = await paypalPlanId("GROWTH", "YEARLY");
    expect(a).not.toBe(b);
    expect(pp.products).toHaveLength(1);
    // Billed in Canadian dollars by default, at the same numbers.
    expect(pp.plans.map((p) => p.name)).toEqual(["WebScout AI Starter — monthly 9.99 CAD", "WebScout AI Growth — yearly 209.00 CAD"]);
    expect(pp.plans[1].body).toMatchObject({ billing_cycles: [{ frequency: { interval_unit: "YEAR", interval_count: 1 }, total_cycles: 0, pricing_scheme: { fixed_price: { value: "209.00", currency_code: "CAD" } } }] });
    // A fresh server process finds the existing plans in PayPal instead of creating duplicates.
    resetPayPalForTests();
    expect(await paypalPlanId("STARTER", "MONTHLY")).toBe(a);
    expect(pp.plans).toHaveLength(2);
    await expect(paypalPlanId("FREE", "MONTHLY")).rejects.toThrow(/Free plan/);
  });

  it("rejects wrong keys with a clear message", async () => {
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "wrong");
    resetPayPalForTests();
    await expect(paypalPlanId("STARTER", "MONTHLY")).rejects.toThrow(/PayPal rejected the app keys/);
  });

  it("activates, renews, fails and cancels a plan from PayPal events", async () => {
    const { ws, owner } = await makeWorkspace();
    const planId = await paypalPlanId("GROWTH", "MONTHLY");
    pp.subs.set("I-SUB1", { id: "I-SUB1", status: "ACTIVE", plan_id: planId, custom_id: ws.id, billing_info: { next_billing_time: "2099-01-01T10:00:00Z" } });
    const s = await getPayPalSubscription("I-SUB1");
    await activatePlan(ws.id, owner.id, "GROWTH", "MONTHLY", "PAYPAL", { providerSubscriptionId: s.id, periodEnd: new Date(s.billing_info!.next_billing_time!) });
    let sub = await getSubscription(ws.id);
    expect(sub).toMatchObject({ plan: "GROWTH", provider: "PAYPAL", providerSubscriptionId: "I-SUB1", status: "ACTIVE" });
    expect((await leadAllowance(ws.id)).limit).toBe(5000);

    // Webhook signature check goes through PayPal.
    const h = (sig: string) => new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.paypal.com/cert", "paypal-transmission-id": "t1", "paypal-transmission-sig": sig, "paypal-transmission-time": "2026-11-07T00:00:00Z" });
    expect(await verifyPayPalWebhook(h("good-sig"), { id: "WH-EVT" })).toBe(true);
    expect(await verifyPayPalWebhook(h("forged"), { id: "WH-EVT" })).toBe(false);

    // A renewal payment is recorded once, however many times PayPal sends it.
    const sale = { id: "EVT-1", event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "SALE-1", billing_agreement_id: "I-SUB1", amount: { total: "20.99", currency: "USD" } } };
    expect(await handlePayPalEvent(sale)).toEqual({ handled: true });
    await handlePayPalEvent(sale);
    const payments = await db.billingPayment.findMany({ where: { workspaceId: ws.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountCents: 2099, method: "PAYPAL", reference: "SALE-1" });

    // Failed payment → past due; the plan holds until the paid period ends.
    await handlePayPalEvent({ event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED", resource: { id: "I-SUB1" } });
    sub = await getSubscription(ws.id);
    expect(sub.status).toBe("PAST_DUE");
    expect(effectivePlan(sub).id).toBe("GROWTH");
    expect(effectivePlan({ ...sub, currentPeriodEnd: new Date(Date.now() - 1000) }).id).toBe("FREE");

    // Cancelled in PayPal → cancelled here, paid time is honoured.
    await handlePayPalEvent({ event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-SUB1" } });
    expect((await getSubscription(ws.id)).status).toBe("CANCELLED");
    expect(await handlePayPalEvent({ event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-UNKNOWN" } })).toMatchObject({ handled: false });
  });

  it("checks lapsed PayPal plans with PayPal when webhooks were missed", async () => {
    const { ws, owner } = await makeWorkspace();
    await activatePlan(ws.id, owner.id, "STARTER", "MONTHLY", "PAYPAL", { providerSubscriptionId: "I-RENEWED", periodEnd: new Date(Date.now() - 60_000) });
    const other = await makeWorkspace();
    await activatePlan(other.ws.id, other.owner.id, "STARTER", "MONTHLY", "PAYPAL", { providerSubscriptionId: "I-GONE", periodEnd: new Date(Date.now() - 60_000) });
    await db.subscription.updateMany({ where: { providerSubscriptionId: { in: ["I-RENEWED", "I-GONE"] } }, data: { updatedAt: new Date(Date.now() - 2 * 3600_000) } });
    pp.subs.set("I-RENEWED", { id: "I-RENEWED", status: "ACTIVE", plan_id: "P-1", billing_info: { next_billing_time: "2099-02-01T00:00:00Z" } });
    pp.subs.set("I-GONE", { id: "I-GONE", status: "CANCELLED", plan_id: "P-1" });
    expect(await syncDuePayPalSubscriptions()).toBeGreaterThanOrEqual(2);
    expect((await getSubscription(ws.id)).currentPeriodEnd.toISOString()).toBe("2099-02-01T00:00:00.000Z");
    const gone = await getSubscription(other.ws.id);
    expect(gone.status).toBe("CANCELLED");
    expect(effectivePlan(gone).id).toBe("FREE");
  });
});
