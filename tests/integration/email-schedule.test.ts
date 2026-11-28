import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { controlEmailRun, createEmailRun, runEmailRunSlice } from "@/lib/server/email/runs";
import { runScheduleTick, saveSchedule, scheduleState, torontoTime } from "@/lib/server/email/schedule";
import { fakeAi, makeWorkspace } from "../helpers";

async function lead(ws: string, name: string) {
  const slug = name.replace(/\W/g, "").toLowerCase();
  const email = `info@${slug}.test`;
  const b = await db.business.create({ data: { workspaceId: ws, name, normalizedName: name.toLowerCase(), city: "Milton", category: "Bakery", businessType: "bakery", email, website: `https://${slug}.test`, websiteDomain: `${slug}.test` } });
  await db.contact.create({ data: { workspaceId: ws, businessId: b.id, email, source: "test", classification: "VERIFIED_PUBLIC", eligibility: "ELIGIBLE" } });
  return b;
}

async function setup(n: number) {
  const { ws, owner } = await makeWorkspace();
  await db.complianceSettings.update({ where: { workspaceId: ws.id }, data: { physicalAddress: "1 King St W, Toronto, ON M5H 1A1" } });
  const leads = [];
  for (let i = 0; i < n; i++) leads.push(await lead(ws.id, `Bakery ${String.fromCharCode(65 + i)}`));
  return { ws, owner, leads };
}

const settings = (perDay: number) => ({ enabled: true, perDay, startTime: "09:30", endTime: "16:30", weekdaysOnly: false, searchMinutes: 30, locations: ["Milton, Ontario"], categories: ["Bakeries"], maxRequests: 10 });
const DAY = "2026-12-01";

describe("daily email schedule", () => {
  beforeEach(() => {
    fakeAi({ outreach_generation: () => ({ subject: "Hello from Studio", body: "Hi there,\n\nA short note.\n\nAlex, Studio" }) });
  });

  it("converts Toronto wall-clock times across daylight saving", () => {
    expect(torontoTime("2026-07-01", "09:30").toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(torontoTime("2026-12-01", "09:30").toISOString()).toBe("2026-12-01T14:30:00.000Z");
  });

  it("sends a daily batch spread over the window, searches when leads run low, and carries leftovers over", async () => {
    const { ws, owner } = await setup(5);
    await saveSchedule(ws.id, owner.id, settings(3));

    // Before the window: nothing yet.
    await runScheduleTick(ws.id, torontoTime(DAY, "08:00"));
    expect(await db.emailRun.count({ where: { workspaceId: ws.id } })).toBe(0);

    // 10:00: today's batch of 3, one roughly every 2 h 10 min until 16:30.
    await runScheduleTick(ws.id, torontoTime(DAY, "10:00"));
    const run = await db.emailRun.findFirstOrThrow({ where: { workspaceId: ws.id } });
    expect(run).toMatchObject({ scheduled: true, total: 3 });
    expect(run.gapSeconds).toBe(7800);
    let s = await db.emailSchedule.findUniqueOrThrow({ where: { workspaceId: ws.id } });
    expect(s.lastBatchDay).toBe(DAY);

    // Only 2 cleared leads remain (< 3 a day): a lead search started, emails-only, no AI drafts.
    expect(s.searchRunId).toBeTruthy();
    const search = await db.automationRun.findUniqueOrThrow({ where: { id: s.searchRunId! } });
    expect(search.name).toMatch(/^Schedule search/);
    expect(search.config).toMatchObject({ requireEmail: true, website: "has", steps: { contacts: true, drafts: false, audit: false } });

    // Same day again: no second batch.
    await runScheduleTick(ws.id, torontoTime(DAY, "10:20"));
    expect(await db.emailRun.count({ where: { workspaceId: ws.id } })).toBe(1);

    // 10:31: the search's 30 minutes are up: it stops finding businesses (and finishes checking the ones it found).
    await runScheduleTick(ws.id, torontoTime(DAY, "10:31"));
    expect((await db.discoveryRun.findUniqueOrThrow({ where: { id: search.discoveryRunId! } })).status).toBe("COMPLETED");
    // 11:01: still running 30 minutes later, it's stopped outright.
    await runScheduleTick(ws.id, torontoTime(DAY, "11:01"));
    expect((await db.automationRun.findUniqueOrThrow({ where: { id: search.id } })).status).toBe("CANCELLED");

    // 16:31: the window closed with nothing sent (no worker ran) — the batch closes and its leads go back in the pool.
    await runScheduleTick(ws.id, torontoTime(DAY, "16:31"));
    const closed = await db.emailRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.skipped).toBe(3);
    expect((await scheduleState(ws.id)).pool).toBe(5);

    // Next morning: a new batch of 3.
    await runScheduleTick(ws.id, torontoTime("2026-12-02", "09:31"));
    const runs = await db.emailRun.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "asc" } });
    expect(runs).toHaveLength(2);
    expect(runs[1]).toMatchObject({ scheduled: true, total: 3, status: "QUEUED" });
    s = await db.emailSchedule.findUniqueOrThrow({ where: { workspaceId: ws.id } });
    expect(s.lastBatchDay).toBe("2026-12-02");
  });

  it("resumes a paused run as the day's batch and pauses it again overnight", async () => {
    const { ws, owner, leads } = await setup(2);
    const { run } = await createEmailRun(ws.id, owner.id, { businessIds: leads.map((l) => l.id), useAi: true, includeNeedsReview: false });
    await controlEmailRun(ws.id, run.id, "pause");
    await saveSchedule(ws.id, owner.id, settings(40));

    await runScheduleTick(ws.id, torontoTime(DAY, "10:00"));
    const resumed = await db.emailRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(resumed.status).toBe("RUNNING");
    expect(resumed.gapSeconds).toBe(11700);
    expect(await db.emailRun.count({ where: { workspaceId: ws.id } })).toBe(1);

    await runScheduleTick(ws.id, torontoTime(DAY, "16:31"));
    const night = await db.emailRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(night.status).toBe("PAUSED");
    expect(night.message).toMatch(/Paused for the night/);
  });

  it("spaces emails out by the run's gap", async () => {
    const { ws, owner, leads } = await setup(2);
    const { run } = await createEmailRun(ws.id, owner.id, { businessIds: leads.map((l) => l.id), useAi: true, includeNeedsReview: false }, { gapSeconds: 600, scheduled: true });
    const r = await runEmailRunSlice(run.id);
    expect(r.message).toBe("Waiting to spread emails out");
    const after = await db.emailRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.sent).toBe(1);
    const wait = after.nextSendAt!.getTime() - Date.now();
    expect(wait).toBeGreaterThan(400_000);
    expect(wait).toBeLessThan(730_000);
  });
});
