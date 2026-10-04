import * as z from "zod";
import { api, parseBody } from "@/lib/server/api";
import { assertCan } from "@/lib/server/auth";
import { changeLeadStatus, getLeadOrThrow } from "@/lib/server/leads";
import { LEAD_STATUSES } from "@/lib/constants";
import { AppError } from "@/lib/server/errors";

export const POST = api({ permission: "leads.changeStatus" }, async (req, ctx, p) => {
  const { status, reason } = await parseBody(req, z.object({ status: z.enum(LEAD_STATUSES), reason: z.string().trim().max(300).optional() }));
  const lead = await getLeadOrThrow(ctx.workspace.id, p.id!);
  if (lead.status === "DO_NOT_CONTACT" && status !== "DO_NOT_CONTACT") {
    assertCan(ctx, "doNotContact.reverse");
    if (!reason || reason.length < 10) throw new AppError("VALIDATION", "Reversing Do Not Contact requires a reason (e.g. the business explicitly asked to be contacted again).");
  }
  const updated = await changeLeadStatus({ workspaceId: ctx.workspace.id, businessId: lead.id, to: status, userId: ctx.user.id, reason });
  return { status: updated.status, statusChangedAt: updated.statusChangedAt };
});
