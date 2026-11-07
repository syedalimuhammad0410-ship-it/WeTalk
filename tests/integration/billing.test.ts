import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { saveIntegrationKey } from "@/lib/server/workspace";
import { activatePlan, leadAllowance } from "@/lib/server/billing";
import { controlDiscoveryRun, createDiscoveryRun, DiscoveryRunInput, processDiscoveryRun } from "@/lib/server/discovery/run";
import { PLANS, getPlan, yearlyDeal } from "@/lib/plans";
import { makeWorkspace } from "../helpers";

const place = (i: number) => ({
  id: `bp-${i}`, displayName: { text: `Painter ${i}` }, formattedAddress: `${i} Main St, Toronto, ON`, nationalPhoneNumber: `(416) 555-${String(2000 + i)}`,
  addressComponents: [{ longText: "Toronto", shortText: "Toronto", types: ["locality"] }], businessStatus: "OPERATIONAL", rating: 4.4, userRatingCount: 9,
  types: ["painter"], primaryType: "painter", primaryTypeDisplayName: { text: "Painter" }, location: { latitude: 43.6 + i * 0.01, longitude: -79.4 },
});

describe("plans and lead allowance", () => {
  it("prices yearly plans at about two months free", () => {
    expect(PLANS.map((p) => [p.id, p.monthlyCents, p.leadsPerMonth])).toEqual([["FREE", 0, 5], ["STARTER", 999, 100], ["GROWTH", 2099, 5000], ["UNLIMITED", 5000, null]]);
    expect(yearlyDeal(getPlan("STARTER")).saving).toBe(999 * 12 - 9900);
    for (const p of PLANS.filter((x) => x.monthlyCents)) expect(p.yearlyCents).toBeLessThanOrEqual(p.monthlyCents * 10);
  });

  it("stops discovery at the Free plan's 5 leads, then continues after an upgrade (demo payment)", async () => {
    const { ws, owner } = await makeWorkspace();
    await db.subscription.update({ where: { workspaceId: ws.id }, data: { plan: "FREE" } });
    await saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIza-test-key-123");
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init!.body));
      if (body.pageSize === 1) return new Response(JSON.stringify({ places: [{ location: { latitude: 43.7, longitude: -79.4 }, viewport: { low: { latitude: 43.58, longitude: -79.64 }, high: { latitude: 43.86, longitude: -79.12 } } }] }), { status: 200 });
      return new Response(JSON.stringify({ places: Array.from({ length: 20 }, (_, i) => place(i)) }), { status: 200 });
    });
    const run = await createDiscoveryRun(ws.id, owner.id, DiscoveryRunInput.parse({ locations: ["Toronto, ON"], queries: ["painters"], target: 50, maxRequests: 20, options: { coverage: "local" } }));
    const r1 = await processDiscoveryRun(run.id, Date.now() + 60_000);
    expect(r1.state).toBe("PAUSED");
    expect(r1.message).toMatch(/used all 5 leads in your Free plan/);
    expect(await db.business.count({ where: { workspaceId: ws.id } })).toBe(5);
    expect((await leadAllowance(ws.id)).remaining).toBe(0);

    // Paid plans need a payment method; the demo payment is recorded but nothing is charged.
    await expect(activatePlan(ws.id, owner.id, "STARTER", "YEARLY", null)).rejects.toThrow(/payment method/);
    const { payment } = await activatePlan(ws.id, owner.id, "STARTER", "YEARLY", "DEMO_CARD");
    expect(payment).toMatchObject({ amountCents: 9900, method: "DEMO_CARD", status: "SUCCEEDED" });
    expect((await leadAllowance(ws.id)).limit).toBe(100);

    await controlDiscoveryRun(ws.id, run.id, "resume");
    await processDiscoveryRun(run.id, Date.now() + 60_000);
    expect(await db.business.count({ where: { workspaceId: ws.id } })).toBe(20); // the rest of the same page, no duplicates
    spy.mockRestore();
  });
});
