import "../guard";
import * as z from "zod";
import { db } from "../../db";
import { AppError, describeError } from "../errors";
import { logActivity, notify } from "../activity";
import { classifyBusinessType } from "../intel/classify-type";
import { upsertBusiness } from "../leads";
import { markIntegration, resolveIntegrationKey } from "../workspace";
import { geocodeWithPlaces, placeToBusiness, searchPlaces } from "./places";
import type { JobContext } from "../jobs/queue";

export const DiscoveryInput = z.object({
  location: z.string().trim().min(2, "Enter a location").max(200),
  category: z.string().trim().max(100).default(""),
  searchTerms: z.string().trim().max(300).default(""),
  radiusKm: z.coerce.number().min(0).max(50).default(0),
  limit: z.coerce.number().int().min(1).max(300).default(60),
  minRating: z.coerce.number().min(0).max(5).default(0),
  maxRating: z.coerce.number().min(0).max(5).default(5),
  website: z.enum(["any", "has", "none"]).default("any"),
  openStatus: z.enum(["operational", "any"]).default("operational"),
  autoAudit: z.boolean().default(true),
  campaignId: z.string().nullable().optional(),
}).refine((v) => v.category || v.searchTerms, { message: "Enter a business category or search terms", path: ["category"] })
  .refine((v) => v.minRating <= v.maxRating, { message: "Minimum rating must be ≤ maximum rating", path: ["minRating"] });
export type DiscoveryInputT = z.infer<typeof DiscoveryInput>;

/** Builds one Text Search query per search term (each query returns ≤ 60 places). */
export function buildQueries(i: DiscoveryInputT) {
  const terms = i.searchTerms.split(",").map((s) => s.trim()).filter(Boolean);
  const base = i.category.trim();
  const list = terms.length ? terms.map((t) => (base ? `${base} ${t}` : t)) : [base];
  return Array.from(new Set(list)).map((q) => `${q} in ${i.location}`);
}

export async function runDiscovery(workspaceId: string, input: DiscoveryInputT, ctx: JobContext, userId: string | null) {
  const key = await resolveIntegrationKey(workspaceId, "GOOGLE_PLACES");
  if (!key) throw new AppError("NOT_CONFIGURED", "Connect the Google Places API in Settings → Integrations to discover businesses.");
  const stats = { found: 0, created: 0, duplicates: 0, filtered: 0, queries: 0 };
  const createdIds: string[] = [];
  let center: { latitude: number; longitude: number } | null = null;
  try {
    if (input.radiusKm > 0) center = (await geocodeWithPlaces(key.key, input.location)).center;
    await ctx.progress({ total: input.limit, processed: 0, message: "Finding businesses…" });
    outer: for (const textQuery of buildQueries(input)) {
      stats.queries++;
      for await (const page of searchPlaces(
        key.key,
        {
          textQuery,
          ...(center ? { locationBias: { circle: { center, radius: input.radiusKm * 1000 } } } : {}),
          ...(input.minRating > 0 ? { minRating: Math.floor(input.minRating * 2) / 2 } : {}),
        },
        input.limit,
      )) {
        if (await ctx.isCancelled()) break outer;
        for (const p of page) {
          const b = placeToBusiness(p);
          if (input.openStatus === "operational" && b.operationalStatus && b.operationalStatus !== "OPERATIONAL") { stats.filtered++; continue; }
          if (b.rating != null && (b.rating < input.minRating || b.rating > input.maxRating)) { stats.filtered++; continue; }
          if (input.maxRating < 5 && b.rating == null) { stats.filtered++; continue; }
          if (input.website === "has" && !b.website) { stats.filtered++; continue; }
          if (input.website === "none" && b.website) { stats.filtered++; continue; }
          const res = await upsertBusiness(workspaceId, b, userId);
          stats.found++;
          if (res.created) {
            stats.created++;
            createdIds.push(res.business.id);
            const t = classifyBusinessType({ googleTypes: b.types, category: b.category, name: b.name });
            await db.business.update({ where: { id: res.business.id }, data: { businessType: t.playbook.id, businessTypeConfidence: t.confidence } });
          } else stats.duplicates++;
          if (input.campaignId) await db.campaignLead.upsert({ where: { campaignId_businessId: { campaignId: input.campaignId, businessId: res.business.id } }, create: { campaignId: input.campaignId, businessId: res.business.id }, update: {} });
          if (stats.found >= input.limit) break outer;
        }
        await ctx.progress({ processed: stats.found, message: `Businesses found: ${stats.found} (${stats.created} new, ${stats.duplicates} already in workspace)` });
      }
    }
    if (key.source === "workspace") await markIntegration(workspaceId, "GOOGLE_PLACES", true);
  } catch (e) {
    const err = e as AppError;
    if (err.code === "INVALID_CREDENTIALS" || err.code === "QUOTA_EXCEEDED") await markIntegration(workspaceId, "GOOGLE_PLACES", false, err.message);
    await notify({ workspaceId, type: "API_FAILURE", title: "Business discovery stopped", body: `${describeError(e)} ${stats.created} new businesses were added before the error.`, link: "/discover" });
    throw new AppError(err.code ?? "INTERNAL", `${describeError(e)} ${stats.created === 0 ? "No new businesses were added." : `${stats.created} new businesses were added before the error.`}`);
  }
  await logActivity({ workspaceId, userId, action: "discovery.completed", summary: `Discovery “${input.category || input.searchTerms}” in ${input.location}: ${stats.created} new, ${stats.duplicates} duplicates`, details: stats });
  if (input.autoAudit && createdIds.length) {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob({ workspaceId, type: "WEBSITE_AUDIT", label: `Analyse ${createdIds.length} new businesses`, payload: { businessIds: createdIds }, createdById: userId });
  }
  const note = stats.found < input.limit ? (stats.queries === 1 ? " Google returns at most 60 results per query — add comma-separated search terms or narrower locations to find more." : "") : "";
  return { ...stats, createdIds, message: `Found ${stats.found} businesses: ${stats.created} new, ${stats.duplicates} already in your workspace${stats.filtered ? `, ${stats.filtered} excluded by filters` : ""}.${note}` };
}
