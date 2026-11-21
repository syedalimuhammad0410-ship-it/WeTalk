import { pageContext } from "@/lib/server/page";
import { commandCentre } from "@/lib/server/claude/centre";
import { CommandCentre } from "@/components/claude/command-centre";

export const metadata = { title: "Claude Command Centre" };
export const dynamic = "force-dynamic";

export default async function ClaudePage({ searchParams }: { searchParams: Promise<{ leads?: string }> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const leads = (sp.leads ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 25);
  const data = await commandCentre(ctx.workspace.id);
  return <CommandCentre initial={JSON.parse(JSON.stringify(data))} perms={{ connect: ctx.can("integrations.manage"), run: ctx.can("discovery.run"), stop: ctx.can("automation.manage") }} selectedLeads={leads} />;
}
