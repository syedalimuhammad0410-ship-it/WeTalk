import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { PageHeader } from "@/components/ui/misc";
import { TemplatesView } from "@/components/templates/templates-view";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const ctx = await pageContext();
  const [templates, leads] = await Promise.all([
    db.emailTemplate.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    db.business.findMany({ where: { workspaceId: ctx.workspace.id, archived: false, websiteClass: { not: null } }, orderBy: { opportunityScore: { sort: "desc", nulls: "last" } }, take: 100, select: { id: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Templates" description="Reusable outreach and follow-up templates. Variables are filled from verified lead data; anything missing stays visible so it's never sent by accident." />
      <TemplatesView templates={JSON.parse(JSON.stringify(templates))} leads={leads} canEdit={ctx.can("templates.manage")} />
    </div>
  );
}
