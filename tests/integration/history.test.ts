import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createConnection } from "@/lib/server/claude/connections";
import { createTask, CreateTaskInput } from "@/lib/server/claude/tasks";
import { submitBusinesses } from "@/lib/server/claude/results";
import { leadsPerDay, searchHistory, searchReplay } from "@/lib/server/history";
import { makeWorkspace } from "../helpers";

describe("Search History", () => {
  it("records every search with its leads, and replays them in the order they were found", async () => {
    const { ws, owner } = await makeWorkspace();
    const { connection } = await createConnection(ws.id, owner.id, "Claude");
    const conn = await db.claudeConnection.findUniqueOrThrow({ where: { id: connection.id } });
    const task = await createTask(ws.id, owner.id, CreateTaskInput.parse({ type: "FIND_LEADS", params: { locations: ["Milton, ON"], businessTypes: ["bakeries"], count: 5, contact: "email_or_phone" } }));
    const running = await db.claudeTask.update({ where: { id: task.id }, data: { status: "RUNNING", claimedAt: new Date() } });
    const biz = (name: string, city: string, lat: number, phone: string) => ({ name, category: "Bakery", city, region: "ON", country: "Canada", latitude: lat, longitude: -79.88, phone, sources: [{ url: `https://maps.example/${name.replace(/\W/g, "")}`, type: "MAPS" as const }] });
    await submitBusinesses({ conn, task: running }, [biz("First Bakery", "Milton", 43.51, "905-555-0101")]);
    await submitBusinesses({ conn, task: running }, [biz("Second Bakery", "Milton", 43.52, "905-555-0102"), biz("Third Bakery", "Hamilton", 43.25, "905-555-0103")]);

    const rows = await searchHistory(ws.id);
    const row = rows.find((r) => r.id === task.id)!;
    expect(row).toMatchObject({ kind: "claude", leads: 3, withPhone: 3, withEmail: 0 });
    expect(row.cities[0]).toEqual({ name: "Milton", count: 2 });

    const replay = await searchReplay(ws.id, "claude", task.id);
    expect(replay.points.map((p) => p.name)).toEqual(["First Bakery", "Second Bakery", "Third Bakery"]);
    expect(replay.points.every((p, i, a) => i === 0 || p.t >= a[i - 1]!.t)).toBe(true);

    const days = await leadsPerDay(ws.id);
    expect(days.reduce((a, d) => a + d.leads, 0)).toBe(3);
  });
});
