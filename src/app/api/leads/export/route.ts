import { NextResponse } from "next/server";
import { api, parseQuery } from "@/lib/server/api";
import { LeadFilters, exportLeadsCsv } from "@/lib/server/queries";
import { logActivity } from "@/lib/server/activity";

export const GET = api({ permission: "leads.export" }, async (req, ctx) => {
  const f = parseQuery(req, LeadFilters);
  const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
  const { csv, count } = await exportLeadsCsv(ctx.workspace.id, f, ids);
  await logActivity({ workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "leads.exported", summary: `Exported ${count} leads to CSV` });
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="webscout-leads-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
});
