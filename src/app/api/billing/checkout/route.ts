import * as z from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkOrigin, jsonError, parseBody } from "@/lib/server/api";
import { getAuthContext, getSessionUser } from "@/lib/server/auth";
import { AppError } from "@/lib/server/errors";
import { createWorkspace } from "@/lib/server/workspace";
import { activatePlan } from "@/lib/server/billing";
import { can } from "@/lib/permissions";
import { PLAN_IDS } from "@/lib/plans";

const Body = z.object({
  plan: z.enum(PLAN_IDS),
  cycle: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  method: z.enum(["DEMO_CARD", "DEMO_PAYPAL"]).nullable().optional(),
  workspaceName: z.string().trim().max(80).optional(),
});

/**
 * Checkout: picks a plan (and, for a new account, creates its workspace).
 * Payments are in DEMO mode — no card data reaches the server and nothing is charged.
 */
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const user = await getSessionUser();
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const b = await parseBody(req, Body);
    const ctx = await getAuthContext();
    let workspaceId: string;
    if (!ctx) {
      if (!b.workspaceName || b.workspaceName.length < 2) throw new AppError("VALIDATION", "Enter your agency or business name (at least 2 characters).");
      workspaceId = (await createWorkspace(user.id, b.workspaceName)).id;
    } else {
      if (!can(ctx.role, "users.manage")) throw new AppError("FORBIDDEN", "Only the workspace owner or an admin can change the plan.");
      workspaceId = ctx.workspace.id;
    }
    const r = await activatePlan(workspaceId, user.id, b.plan, b.cycle, b.method ?? null);
    const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { onboardingCompleted: true } });
    return NextResponse.json({ ok: true, plan: r.subscription.plan, paymentReference: r.payment?.reference ?? null, next: ws.onboardingCompleted ? "/dashboard" : "/onboarding" });
  } catch (e) {
    return jsonError(e);
  }
}
