import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { upsertBusiness } from "@/lib/server/leads";
import { classifyBusinessType } from "@/lib/server/intel/classify-type";
import { db } from "@/lib/db";
import { AppError } from "@/lib/server/errors";
import { logActivity } from "@/lib/server/activity";
import { parseCsv } from "@/lib/csv";

const COLS: Record<string, string> = { business: "name", name: "name", "business name": "name", category: "category", address: "address", city: "city", region: "region", province: "region", state: "region", phone: "phone", website: "website", url: "website", email: "email" };

export const POST = api({ permission: "leads.edit" }, async (req, ctx) => {
  const { csv, emailSource } = await parseBody(req, z.object({ csv: z.string().max(5_000_000), emailSource: z.string().trim().max(200).default("CSV import (user-provided)") }));
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError("VALIDATION", "The CSV needs a header row and at least one data row.");
  const header = rows[0]!.map((h) => COLS[h.trim().toLowerCase()] ?? null);
  if (!header.includes("name")) throw new AppError("VALIDATION", "The CSV must have a “Business” or “Name” column.");
  let created = 0, duplicates = 0, skipped = 0;
  for (const r of rows.slice(1, 5001)) {
    const rec: Record<string, string> = {};
    header.forEach((k, i) => { if (k && r[i]?.trim()) rec[k] = r[i]!.trim(); });
    if (!rec.name) { skipped++; continue; }
    if (rec.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(rec.email)) delete rec.email;
    const res = await upsertBusiness(ctx.workspace.id, { ...rec, name: rec.name, emailSource: rec.email ? emailSource : null, source: "CSV_IMPORT" }, ctx.user.id);
    if (res.created) {
      created++;
      const t = classifyBusinessType({ category: rec.category, name: rec.name });
      await db.business.update({ where: { id: res.business.id }, data: { businessType: t.playbook.id, businessTypeConfidence: t.confidence } });
    } else duplicates++;
  }
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "leads.imported", summary: `CSV import: ${created} created, ${duplicates} duplicates, ${skipped} skipped` });
  return { created, duplicates, skipped };
});
