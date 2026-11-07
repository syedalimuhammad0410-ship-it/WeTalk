import { redirect } from "next/navigation";
import { getAuthContext, getSessionUser } from "@/lib/server/auth";
import { getSubscription } from "@/lib/server/billing";
import { can } from "@/lib/permissions";
import { PLAN_IDS } from "@/lib/plans";
import { Checkout } from "@/components/billing/checkout";

export const metadata = { title: "Choose your plan" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string; cycle?: string }> }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/checkout?plan=${sp.plan ?? "FREE"}&cycle=${sp.cycle ?? "MONTHLY"}`)}`);
  const ctx = await getAuthContext();
  const sub = ctx ? await getSubscription(ctx.workspace.id) : null;
  const plan = (PLAN_IDS as readonly string[]).includes((sp.plan ?? "").toUpperCase()) ? (sp.plan!.toUpperCase() as (typeof PLAN_IDS)[number]) : null;
  return (
    <Checkout
      userName={user.name}
      hasWorkspace={Boolean(ctx)}
      workspaceName={ctx?.workspace.name ?? null}
      canManage={ctx ? can(ctx.role, "users.manage") : true}
      currentPlan={sub?.plan ?? null}
      onboardingDone={Boolean(ctx?.workspace.onboardingCompleted)}
      initialPlan={plan ?? (sub ? null : "FREE")}
      initialCycle={sp.cycle?.toUpperCase() === "YEARLY" ? "YEARLY" : "MONTHLY"}
    />
  );
}
