import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { runDiscovery, DiscoveryInput } from "@/lib/server/discovery/service";
import { runWebsiteAudit } from "@/lib/server/audit/service";
import { saveIntegrationKey } from "@/lib/server/workspace";
import type { JobContext } from "@/lib/server/jobs/queue";
import { makeWorkspace, noAi } from "../helpers";
// @ts-expect-error — plain ESM helper
import { startFixtureServer } from "../tools/fixture-server.mjs";

const ctx = { job: {} as never, progress: async () => {}, isCancelled: async () => false } as unknown as JobContext;
const place = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `place-${i}`, displayName: { text: `Biz ${i}` }, formattedAddress: `${i} Main St, Mississauga, ON`, nationalPhoneNumber: `(905) 555-${String(1000 + i)}`,
  addressComponents: [{ longText: "Mississauga", shortText: "Mississauga", types: ["locality"] }], businessStatus: "OPERATIONAL", rating: 4.2, userRatingCount: 30, types: ["plumber"], primaryType: "plumber", primaryTypeDisplayName: { text: "Plumber" }, ...extra,
});

let servers: { server: import("node:http").Server; url: string }[] = [];
beforeAll(async () => {
  noAi();
  servers = await Promise.all(["outdated", "modern", "blocked"].map((s) => startFixtureServer(s)));
});
afterAll(() => servers.forEach((s) => s.server.close()));

describe("business discovery (Google Places API, mocked)", () => {
  it("paginates, stores only real fields, dedupes on re-run and applies filters", async () => {
    const { ws, owner } = await makeWorkspace();
    await saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIza-test-key-123");
    const pages = [
      { places: Array.from({ length: 20 }, (_, i) => place(i, i === 3 ? { websiteUri: "https://biz3.example.com" } : {})), nextPageToken: "p2" },
      { places: [...Array.from({ length: 5 }, (_, i) => place(20 + i)), place(99, { businessStatus: "CLOSED_PERMANENTLY" })] },
    ];
    const bodies: Record<string, unknown>[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
      expect((init!.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("places.websiteUri");
      const body = JSON.parse(String(init!.body));
      bodies.push(body);
      return new Response(JSON.stringify(body.pageToken ? pages[1] : pages[0]), { status: 200 });
    });
    const input = DiscoveryInput.parse({ location: "Mississauga, Ontario", category: "Plumbers", limit: 60, autoAudit: false });
    const r1 = await runDiscovery(ws.id, input, ctx, owner.id);
    expect(r1.created).toBe(25);
    expect(r1.filtered).toBe(1); // closed business excluded
    expect(bodies[1]!.pageToken).toBe("p2");
    const b3 = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, sourceId: "place-3" } });
    expect(b3.website).toBe("https://biz3.example.com/");
    expect(b3.email).toBeNull(); // Google never provides emails; nothing invented
    expect(b3.businessType).toBe("plumber");
    const b4 = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, sourceId: "place-4" } });
    expect(b4.websiteStatus).toBe("NO_WEBSITE");
    const r2 = await runDiscovery(ws.id, input, ctx, owner.id);
    expect(r2.created).toBe(0);
    expect(r2.duplicates).toBe(25);
    expect(await db.business.count({ where: { workspaceId: ws.id } })).toBe(25);
    const r3 = await runDiscovery(ws.id, DiscoveryInput.parse({ location: "Mississauga", category: "Plumbers", website: "has", autoAudit: false }), ctx, owner.id);
    expect(r3.found).toBe(1);
    spy.mockRestore();
  });

  it("reports quota errors clearly and keeps what was already added", async () => {
    const { ws, owner } = await makeWorkspace();
    await saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIza-test-key-123");
    let call = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ places: [place(1), place(2)], nextPageToken: "x" }), { status: 200 });
      return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }), { status: 429 });
    });
    await expect(runDiscovery(ws.id, DiscoveryInput.parse({ location: "Toronto", category: "Plumbers", autoAudit: false }), ctx, owner.id)).rejects.toThrow(/Google Places API quota exceeded.*2 new businesses were added/);
    expect(await db.business.count({ where: { workspaceId: ws.id } })).toBe(2);
    const cred = await db.integrationCredential.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(cred.status).toBe("ERROR");
    spy.mockRestore();
  });

  it("refuses to run without a configured key", async () => {
    const { ws, owner } = await makeWorkspace();
    await expect(runDiscovery(ws.id, DiscoveryInput.parse({ location: "Toronto", category: "X" }), ctx, owner.id)).rejects.toThrow(/Connect the Google Places API/);
  });
});

describe("website audit engine (fixture sites)", () => {
  async function lead(website: string | null, name = "ABC Cleaning Services", category = "House cleaning service") {
    const { ws } = await makeWorkspace();
    const b = await db.business.create({ data: { workspaceId: ws.id, name, normalizedName: name.toLowerCase(), category, city: "Mississauga", website, websiteStatus: website ? "WEBSITE_FOUND" : "UNKNOWN" } });
    return { ws, b };
  }

  it("scores an outdated site low with explainable checks and extracts public facts", async () => {
    const { ws, b } = await lead(servers[0]!.url);
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(r.classification).toBe("OUTDATED");
    expect(r.overall!).toBeLessThan(45);
    const audit = await db.websiteAudit.findUniqueOrThrow({ where: { id: r.auditId }, include: { findings: true } });
    const breakdown = audit.scoreBreakdown as Record<string, { id: string; evidence: string }[]>;
    expect(breakdown.mobile!.find((c) => c.id === "mobile.viewport")!.evidence).toMatch(/Missing viewport/);
    expect(audit.findings.some((f) => f.code === "feature.missing.quote_request" && f.kind === "INFERRED")).toBe(true);
    const ex = audit.extracted as { emails: string[]; pagesAnalysed: unknown[]; copyrightYear: number };
    expect(ex.emails).toContain("info@abccleaning.example");
    expect(ex.pagesAnalysed.length).toBeGreaterThan(1);
    expect(ex.copyrightYear).toBe(2016);
    const updated = await db.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(updated.email).toBe("info@abccleaning.example");
    expect(updated.emailSource).toMatch(/Publicly listed on website/);
    expect(updated.opportunityScore!).toBeGreaterThanOrEqual(70);
    expect(updated.status).toBe("HIGH_OPPORTUNITY");
  });

  it("does not punish a well-built site", async () => {
    const { ws, b } = await lead(servers[1]!.url, "Luigi's Trattoria", "Italian restaurant");
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(["MODERN", "STRONG", "EXCELLENT"]).toContain(r.classification);
    expect(r.overall!).toBeGreaterThan(60);
    const opp = await db.opportunity.findFirstOrThrow({ where: { businessId: b.id } });
    const feats = opp.recommendedFeatures as { key: string; status: string }[];
    expect(feats.find((f) => f.key === "reservations")!.status).toBe("present");
    expect(feats.find((f) => f.key === "online_ordering")!.status).toBe("present");
    expect(r.opportunity).toBeLessThan(60);
  });

  it("respects robots.txt and never bypasses it", async () => {
    const { ws, b } = await lead(servers[2]!.url);
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(r.websiteStatus).toBe("WEBSITE_BLOCKED");
    expect(r.classification).toBe("MANUAL_REVIEW");
  });

  it("detects unavailable websites", async () => {
    const tmp = await startFixtureServer("outdated");
    const port = (tmp.server.address() as AddressInfo).port;
    tmp.server.close();
    const { ws, b } = await lead(`http://127.0.0.1:${port}`);
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(r.websiteStatus).toBe("WEBSITE_UNAVAILABLE");
    expect(r.classification).toBe("BROKEN");
  });

  it("handles businesses with no website", async () => {
    const { ws, b } = await lead(null);
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(r.classification).toBe("NO_WEBSITE");
    expect(r.opportunity).toBeGreaterThanOrEqual(50);
  });

  it("blocks private-network targets when SSRF protection is on", async () => {
    process.env.AUDIT_ALLOW_PRIVATE_HOSTS = "false";
    const { ws, b } = await lead("http://127.0.0.1/");
    const r = await runWebsiteAudit(ws.id, b.id);
    expect(r.classification).toBe("MANUAL_REVIEW");
    const f = await db.websiteFinding.findFirstOrThrow({ where: { auditId: r.auditId } });
    expect(f.detail).toMatch(/private network|Internal/i);
    process.env.AUDIT_ALLOW_PRIVATE_HOSTS = "true";
  });
});
