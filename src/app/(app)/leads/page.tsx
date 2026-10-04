import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { LeadFilters, listLeads, pipelineColumns } from "@/lib/server/queries";
import { PLAYBOOKS } from "@/lib/server/intel/playbooks";
import { PageHeader } from "@/components/ui/misc";
import { LeadsView } from "@/components/leads/leads-view";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext();
  const sp = await searchParams;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") flat[k] = v;
  const parsed = LeadFilters.safeParse(flat);
  const filters = parsed.success ? parsed.data : LeadFilters.parse({});
  const view = flat.view === "pipeline" ? "pipeline" : "table";
  const ws = ctx.workspace.id;
  const [data, columns, tags, members, campaigns, savedFilters, templates] = await Promise.all([
    view === "table" ? listLeads(ws, filters) : Promise.resolve(null),
    view === "pipeline" ? pipelineColumns(ws, filters) : Promise.resolve(null),
    db.tag.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.workspaceMember.findMany({ where: { workspaceId: ws }, select: { user: { select: { id: true, name: true } } } }),
    db.campaign.findMany({ where: { workspaceId: ws }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
    db.savedFilter.findMany({ where: { workspaceId: ws, OR: [{ shared: true }, { userId: ctx.user.id }] }, orderBy: { name: "asc" }, select: { id: true, name: true, filters: true } }),
    db.emailTemplate.findMany({ where: { workspaceId: ws, kind: "OUTREACH" }, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Leads" description="Every business you've discovered, with website status, opportunity and pipeline stage." />
      <LeadsView
        view={view}
        filters={JSON.parse(JSON.stringify(filters))}
        data={JSON.parse(JSON.stringify(data))}
        columns={JSON.parse(JSON.stringify(columns))}
        options={{
          tags,
          members: members.map((m) => m.user),
          campaigns,
          savedFilters: JSON.parse(JSON.stringify(savedFilters)),
          templates,
          businessTypes: PLAYBOOKS.map((p) => ({ id: p.id, label: p.label })).sort((a, b) => a.label.localeCompare(b.label)),
        }}
        perms={{ edit: ctx.can("leads.edit"), status: ctx.can("leads.changeStatus"), del: ctx.can("leads.delete"), exp: ctx.can("leads.export"), send: ctx.can("emails.send"), reverseDnc: ctx.can("doNotContact.reverse") }}
        openAdd={flat.add === "1"}
      />
    </div>
  );
}
