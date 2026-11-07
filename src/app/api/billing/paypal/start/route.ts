import * as z from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { checkOrigin, jsonError, parseBody } from "@/lib/server/api";
import { getAuthContext, getSessionUser } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { createWorkspace } from "@/lib/server/workspace";
import { paypalPlanId } from "@/lib/server/paypal";
import { can } from "@/lib/permissions";
import { PLAN_IDS } from "@/lib/plans";

const Body = z.object({ plan: z.enum(PLAN_IDS), cycle: z.enum(["MONTHLY", "YEARLY"]), workspaceName: z.string().trim().max(80).optional() });

/** Called when the customer clicks a PayPal button: returns the PayPal plan to subscribe to and our workspace id. */
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const user = await getSessionUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const b = await parseBody(req, Body);
    if (b.plan === "FREE") throw new AppError("VALIDATION", "The Free plan needs no payment.");
    const ctx = await getAuthContext();
    let workspaceId: string;
    if (!ctx) {
      if (!b.workspaceName || b.workspaceName.length < 2) throw new AppError("VALIDATION", "Enter your agency or business name first (at least 2 characters).");
      workspaceId = (await createWorkspace(user.id, b.workspaceName)).id; // starts on Free until PayPal confirms
    } else {
      if (!can(ctx.role, "users.manage")) throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can change the plan.");
      workspaceId = ctx.workspace.id;
    }
    return NextResponse.json({ paypalPlanId: await paypalPlanId(b.plan, b.cycle), customId: workspaceId });
  } catch (e) {
    return jsonError(e);
  }
}
