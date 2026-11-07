import "./guard";
import { AppError, fetchWithTimeout } from "./errors";
import { getPlan, type Cycle, type PlanId } from "../plans";

/**
 * PayPal Subscriptions (REST API). Every payment — PayPal balance or a card through
 * PayPal's card button — goes to the PayPal account that owns PAYPAL_CLIENT_ID.
 * Configure in the host's environment: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
 * PAYPAL_MODE (sandbox|live), optional PAYPAL_CURRENCY (default USD) and PAYPAL_WEBHOOK_ID.
 */
export function paypalConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  const mode = process.env.PAYPAL_MODE?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  return {
    enabled: Boolean(clientId && secret),
    clientId,
    secret,
    mode,
    currency: (process.env.PAYPAL_CURRENCY?.trim() || "USD").toUpperCase(),
    webhookId: process.env.PAYPAL_WEBHOOK_ID?.trim() ?? "",
    base: mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}

let token: { value: string; exp: number; key: string } | null = null;
async function accessToken() {
  const c = paypalConfig();
  if (!c.enabled) throw new AppError("NOT_CONFIGURED", "PayPal payments aren't connected yet.");
  const key = `${c.mode}:${c.clientId}`;
  if (token && token.key === key && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetchWithTimeout(`${c.base}/v1/oauth2/token`, {
    service: "PayPal",
    timeoutMs: 20000,
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!res.ok || !data?.access_token) throw new AppError("INVALID_CREDENTIALS", `PayPal rejected the app keys (${data?.error_description ?? `HTTP ${res.status}`}). Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MODE (sandbox keys only work with sandbox mode).`);
  token = { value: data.access_token, exp: Date.now() + (data.expires_in ?? 3000) * 1000, key };
  return token.value;
}

/** Tests: forget the cached token. */
export function resetPayPalForTests() {
  token = null;
  planCache.clear();
}

export async function paypal<T>(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const c = paypalConfig();
  const res = await fetchWithTimeout(`${c.base}${path}`, {
    service: "PayPal",
    timeoutMs: 20000,
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & { message?: string; name?: string; details?: { description?: string }[] }) | null;
  if (!res.ok) throw new AppError(res.status === 404 ? "NOT_FOUND" : "UPSTREAM_ERROR", `PayPal: ${data?.message ?? data?.name ?? `HTTP ${res.status}`}${data?.details?.[0]?.description ? ` — ${data.details[0].description}` : ""}`);
  return data as T;
}

const PRODUCT_NAME = "WebScout AI";
const planCache = new Map<string, string>();

/** The PayPal billing plan for a WebScout plan + cycle — created in your PayPal account the first time, then reused. */
export async function paypalPlanId(id: PlanId, cycle: Cycle) {
  const c = paypalConfig();
  const plan = getPlan(id);
  const amount = cycle === "YEARLY" ? plan.yearlyCents : plan.monthlyCents;
  if (!amount) throw new AppError("VALIDATION", "The Free plan needs no payment.");
  const price = (amount / 100).toFixed(2);
  const name = `WebScout AI ${plan.name} — ${cycle === "YEARLY" ? "yearly" : "monthly"} ${price} ${c.currency}`;
  const key = `${c.mode}:${c.clientId}:${name}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const products = await paypal<{ products?: { id: string; name: string }[] }>("GET", "/v1/catalogs/products?page_size=20");
  let productId = products.products?.find((p) => p.name === PRODUCT_NAME)?.id;
  if (!productId) productId = (await paypal<{ id: string }>("POST", "/v1/catalogs/products", { name: PRODUCT_NAME, description: "WebScout AI — find businesses that need a website and win them as clients", type: "SERVICE", category: "SOFTWARE" })).id;
  const plans = await paypal<{ plans?: { id: string; name: string; status: string }[] }>("GET", `/v1/billing/plans?product_id=${encodeURIComponent(productId)}&page_size=20`);
  let planId = plans.plans?.find((p) => p.name === name && p.status === "ACTIVE")?.id;
  if (!planId) {
    planId = (
      await paypal<{ id: string }>(
        "POST",
        "/v1/billing/plans",
        {
          product_id: productId,
          name,
          description: `${plan.name}: ${plan.leadsPerMonth == null ? "unlimited" : plan.leadsPerMonth.toLocaleString("en-US")} new leads per month`,
          status: "ACTIVE",
          billing_cycles: [{ frequency: { interval_unit: cycle === "YEARLY" ? "YEAR" : "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: price, currency_code: c.currency } } }],
          payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
        },
        { Prefer: "return=representation" },
      )
    ).id;
  }
  planCache.set(key, planId);
  return planId;
}

export type PayPalSubscription = {
  id: string;
  status: string;
  plan_id: string;
  custom_id?: string;
  billing_info?: { next_billing_time?: string; last_payment?: { amount?: { value: string; currency_code: string }; time?: string } };
};

export const getPayPalSubscription = (id: string) => paypal<PayPalSubscription>("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
export const cancelPayPalSubscription = (id: string, reason: string) => paypal<void>("POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 120) });

/** Confirms a webhook really came from PayPal (needs PAYPAL_WEBHOOK_ID). */
export async function verifyPayPalWebhook(headers: Headers, event: unknown) {
  const c = paypalConfig();
  if (!c.enabled || !c.webhookId) return false;
  const r = await paypal<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: c.webhookId,
    webhook_event: event,
  });
  return r?.verification_status === "SUCCESS";
}
