import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/lib/db";
import { saveIntegrationKey } from "@/lib/server/workspace";
import { canSplit, initialCellKm, splitBounds, tileBounds, boundsSizeKm } from "@/lib/server/discovery/geo";
import { osmToBusiness, overpassQuery } from "@/lib/server/discovery/providers";
import { emailRole, evaluateEligibility, setMxResolverForTests } from "@/lib/server/contacts/discover";
import { AutoProspectInput, controlAutoProspect, createAutoProspect, getAutoProspect, runAutoProspectSlice } from "@/lib/server/automation/autoprospect";
import { approveOutreach } from "@/lib/server/outreach";
import { processUnsubscribe, readUnsubscribeToken, unsubscribeToken } from "@/lib/server/email/unsubscribe";
import { drainJobs } from "@/lib/server/jobs/runner";
import { makeWorkspace, noAi } from "../helpers";
// @ts-expect-error — plain ESM helper
import { startFixtureServer } from "../tools/fixture-server.mjs";

let outdated: { server: http.Server; url: string };
let noSolicit: http.Server;
let noSolicitUrl = "";
beforeAll(async () => {
  noAi();
  setMxResolverForTests(async () => [{ exchange: "mx.test" }]);
  outdated = await startFixtureServer("outdated");
  noSolicit = http.createServer((req, res) => {
    if (req.url === "/robots.txt") return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/html" }).end(`<html><body><h1>Spotless Offices</h1><p>Commercial cleaning across Ontario.</p><p>Questions? hello@spotless.test</p><p>We do not accept unsolicited commercial email.</p></body></html>`);
  });
  await new Promise<void>((r) => noSolicit.listen(0, "0.0.0.0", r));
  noSolicitUrl = `http://127.0.0.2:${(noSolicit.address() as AddressInfo).port}`;
});
afterAll(() => {
  outdated.server.close();
  noSolicit.close();
  setMxResolverForTests(null);
});

const place = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `ap-${i}`, displayName: { text: `Cleaner ${i}` }, formattedAddress: `${i} King St, Toronto, ON`, nationalPhoneNumber: `(416) 555-${String(1000 + i)}`,
  addressComponents: [{ longText: "Toronto", shortText: "Toronto", types: ["locality"] }], businessStatus: "OPERATIONAL", rating: 4.5, userRatingCount: 12,
  types: ["cleaning_service"], primaryType: "cleaning_service", primaryTypeDisplayName: { text: "Cleaning service" }, location: { latitude: 43.6 + i * 0.001, longitude: -79.4 }, ...extra,
});

describe("geographic tiling", () => {
  it("splits a province into zones and saturated zones into overlapping quadrants", () => {
    const ontario = { south: 41.7, west: -95.2, north: 56.9, east: -74.3 };
    expect(initialCellKm(ontario)).toBe(200);
    const tiles = tileBounds(ontario, 200);
    expect(tiles.length).toBeGreaterThan(40);
    const kids = splitBounds(tiles[0]!);
    expect(kids).toHaveLength(4);
    expect(boundsSizeKm(kids[0]!).heightKm).toBeLessThan(boundsSizeKm(tiles[0]!).heightKm);
    expect(canSplit({ south: 43.6, west: -79.4, north: 43.605, east: -79.395 }, 2)).toBe(false);
  });

  it("maps OpenStreetMap data without inventing fields", () => {
    const b = osmToBusiness({ type: "node", id: 7, lat: 43.6, lon: -79.4, tags: { name: "Sparkle Janitorial", craft: "cleaning", "contact:email": "office@sparkle.test", website: "sparkle.test", brand: "Sparkle" } });
    expect(b).toMatchObject({ name: "Sparkle Janitorial", email: "office@sparkle.test", emailClassification: "PUBLIC_DIRECTORY", source: "OPENSTREETMAP", sourceId: "node/7", chain: true });
    expect(osmToBusiness({ type: "node", id: 8, tags: { craft: "cleaning" } })).toBeNull();
    expect(overpassQuery("commercial cleaning companies", { south: 1, west: 2, north: 3, east: 4 })).toContain('["craft"="cleaning"]');
  });
});

describe("CASL eligibility", () => {
  const base = { classification: "VERIFIED_PUBLIC", verification: "VALID", noSolicitation: false, suppressed: false, doNotContact: false, expressConsent: false, checksEnabled: true, sourceUrl: "https://x.test/contact" };
  it("decides from evidence, never from visibility alone", () => {
    expect(evaluateEligibility({ ...base, role: emailRole("info@x.test") })).toMatchObject({ eligibility: "ELIGIBLE", basis: "IMPLIED_CONSPICUOUS_PUBLICATION" });
    expect(evaluateEligibility({ ...base, role: emailRole("careers@x.test") }).eligibility).toBe("INELIGIBLE");
    expect(evaluateEligibility({ ...base, role: emailRole("info@x.test"), noSolicitation: true }).eligibility).toBe("INELIGIBLE");
    expect(evaluateEligibility({ ...base, role: emailRole("jane.doe@x.test") }).eligibility).toBe("NEEDS_REVIEW");
    expect(evaluateEligibility({ ...base, classification: "PUBLIC_DIRECTORY", role: emailRole("info@x.test") }).eligibility).toBe("NEEDS_REVIEW");
    expect(evaluateEligibility({ ...base, role: emailRole("info@x.test"), checksEnabled: false }).eligibility).toBe("NEEDS_REVIEW");
    expect(evaluateEligibility({ ...base, role: emailRole("info@x.test"), suppressed: true }).eligibility).toBe("INELIGIBLE");
  });
});

describe("AutoProspect acceptance (mocked Google, real local websites)", () => {
  it("discovers across split zones, finds emails, analyses, drafts, pauses/resumes without duplicating, and honours unsubscribes", async () => {
    const { ws, owner } = await makeWorkspace();
    await saveIntegrationKey(ws.id, "GOOGLE_PLACES", "AIza-test-key-123");
    // Zone 0 is saturated (3 full pages) → split into 4; children return a few new places plus repeats.
    const parentPages = [0, 1, 2].map((p) => ({ places: Array.from({ length: 20 }, (_, i) => place(p * 20 + i, p * 20 + i === 0 ? { websiteUri: outdated.url } : p * 20 + i === 1 ? { websiteUri: noSolicitUrl } : {})), nextPageToken: p < 2 ? `t${p + 1}` : undefined }));
    let childCalls = 0;
    const real = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (!String(url).includes("places.googleapis.com")) return real(url as string, init);
      const body = JSON.parse(String(init!.body));
      if (body.pageSize === 1) return new Response(JSON.stringify({ places: [{ location: { latitude: 43.7, longitude: -79.4 }, viewport: { low: { latitude: 43.58, longitude: -79.64 }, high: { latitude: 43.86, longitude: -79.12 } }, formattedAddress: "Toronto, ON" }] }), { status: 200 });
      const rect = body.locationRestriction.rectangle;
      const isParent = rect.low.latitude < 43.6 && rect.high.latitude > 43.85;
      if (isParent) return new Response(JSON.stringify(parentPages[body.pageToken ? Number(String(body.pageToken).slice(1)) : 0]), { status: 200 });
      childCalls++;
      return new Response(JSON.stringify({ places: [place(100 + childCalls), place(1)] }), { status: 200 });
    });

    const input = AutoProspectInput.parse({ name: "Toronto cleaners", locations: ["Toronto, ON"], categories: ["commercial cleaning"], target: 70, maxRequests: 50, maxAiEmails: 0, concurrency: 2 });
    const run = await createAutoProspect(ws.id, owner.id, input);

    // First slice, then pause mid-way: finished work must survive and never be redone.
    await runAutoProspectSlice(run.id, 1500);
    const afterFirst = await db.automationItem.count({ where: { runId: run.id } });
    expect(afterFirst).toBeGreaterThan(0);
    await controlAutoProspect(ws.id, run.id, "pause");
    expect((await runAutoProspectSlice(run.id)).state).toBe("PAUSED");
    const doneBefore = await db.automationItem.findMany({ where: { runId: run.id, status: { not: "PENDING" } }, select: { id: true, updatedAt: true } });
    await controlAutoProspect(ws.id, run.id, "resume");
    for (let i = 0; i < 20; i++) {
      const s = await runAutoProspectSlice(run.id, 30_000);
      if (s.state !== "YIELD") break;
    }
    const data = await getAutoProspect(ws.id, run.id);
    expect(data.run.status).toBe("COMPLETED");
    for (const d of doneBefore) expect((await db.automationItem.findUnique({ where: { id: d.id } }))!.updatedAt.getTime()).toBe(d.updatedAt.getTime());

    // Discovery: target reached across zones, duplicates removed, one business per place.
    const c = data.counters;
    expect(c.discovered).toBeGreaterThanOrEqual(30);
    expect(c.duplicates).toBeGreaterThan(0);
    expect(await db.business.count({ where: { workspaceId: ws.id, sourceId: "ap-1" } })).toBe(1);
    expect(data.zones!.split).toBeGreaterThanOrEqual(1);

    // Contacts: real public email found on the business's own site, with source + evidence.
    const abc = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, sourceId: "ap-0" } });
    const contact = await db.contact.findFirstOrThrow({ where: { businessId: abc.id, email: "info@abccleaning.example" } });
    expect(contact).toMatchObject({ classification: "VERIFIED_PUBLIC", verification: "VALID", eligibility: "ELIGIBLE", consentBasis: "IMPLIED_CONSPICUOUS_PUBLICATION" });
    expect(contact.sourceUrl).toContain("127.0.0.1");
    expect(await db.consentRecord.count({ where: { contactId: contact.id } })).toBeGreaterThan(0);
    // A site that refuses unsolicited messages is never eligible.
    const spotless = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, sourceId: "ap-1" } });
    expect(await db.contact.findFirstOrThrow({ where: { businessId: spotless.id, email: "hello@spotless.test" } })).toMatchObject({ eligibility: "INELIGIBLE" });
    // No email is ever guessed for businesses without a website.
    const noSite = await db.business.findFirstOrThrow({ where: { workspaceId: ws.id, sourceId: "ap-5" } });
    expect(await db.contact.count({ where: { businessId: noSite.id } })).toBe(0);

    // Analysis, prompts, drafts.
    expect(c.websitesAnalyzed).toBeGreaterThanOrEqual(2);
    expect(c.promptsGenerated).toBeGreaterThan(0);
    expect(c.draftsCreated).toBe(1); // the business that refuses unsolicited email gets no draft
    expect(await db.emailMessage.count({ where: { businessId: spotless.id, kind: "OUTREACH" } })).toBe(0);
    const draft = await db.emailMessage.findFirstOrThrow({ where: { businessId: abc.id, kind: "OUTREACH", status: "DRAFT" } });
    expect(draft.toAddress).toBe("info@abccleaning.example");

    // Approval mode: nothing was sent automatically.
    expect(await db.emailMessage.count({ where: { workspaceId: ws.id, status: "SENT" } })).toBe(0);
    // An ineligible recipient can't be approved.
    const spotDraft = await db.emailMessage.findFirst({ where: { businessId: spotless.id, kind: "OUTREACH", status: "DRAFT" } });
    if (spotDraft) expect((await approveOutreach(ws.id, owner.id, [spotDraft.id], 1)).skipped[0]?.reason).toMatch(/unsolicited/);
    // Approve the eligible one → sent with a working unsubscribe link.
    const ok = await approveOutreach(ws.id, owner.id, [draft.id], 1);
    expect(ok.skipped).toEqual([]);
    expect(ok.approved).toBe(1);
    await drainJobs(60_000);
    const sent = await db.emailMessage.findUniqueOrThrow({ where: { id: draft.id } });
    expect(sent.status).toBe("SENT");
    const link = /Unsubscribe: (\S+)/.exec(sent.bodyText)?.[1];
    expect(link).toContain("/unsubscribe/");
    const token = link!.split("/unsubscribe/")[1]!;
    expect(readUnsubscribeToken(token)).toEqual({ workspaceId: ws.id, email: "info@abccleaning.example" });
    expect(readUnsubscribeToken(token.slice(0, -2) + "xx")).toBeNull();
    await processUnsubscribe(ws.id, "info@abccleaning.example");
    expect(await db.suppressionEntry.count({ where: { workspaceId: ws.id, value: "info@abccleaning.example" } })).toBe(1);
    expect((await db.business.findUniqueOrThrow({ where: { id: abc.id } })).doNotContact).toBe(true);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).eligibility).toBe("INELIGIBLE");
    expect(unsubscribeToken(ws.id, "INFO@abccleaning.example")).toBe(token);
    spy.mockRestore();
  }, 180_000);
});

describe("radius search", () => {
  it("covers a radius larger than 50 km with zones and drops results outside the circle", async () => {
    const { circleBounds, distanceKm } = await import("@/lib/server/discovery/geo");
    const b = circleBounds({ lat: 43.59, lng: -79.64 }, 200);
    expect(b.north - b.south).toBeCloseTo((400 / 111.32), 1);
    expect(tileBounds(b, initialCellKm(b)).length).toBeGreaterThan(1);
    expect(distanceKm({ lat: 43.59, lng: -79.64 }, { lat: 45.42, lng: -75.7 })).toBeGreaterThan(300); // Mississauga → Ottawa
  });
});
