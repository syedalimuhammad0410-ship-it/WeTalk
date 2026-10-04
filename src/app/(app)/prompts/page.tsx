import Link from "next/link";
import { FileCode2 } from "lucide-react";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Prompts" };

export default async function PromptsPage() {
  const ctx = await pageContext();
  const prompts = await db.generatedPrompt.findMany({
    where: { workspaceId: ctx.workspace.id },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { business: { select: { id: true, name: true, city: true, businessType: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { wordCount: true, generator: true } } },
  });
  return (
    <div>
      <PageHeader title="Website Prompts" description="Business-specific website-development specifications, ready to paste into Claude Code, Lovable, Replit, Cursor or Gemini." />
      {prompts.length === 0 ? (
        <Card><EmptyState icon={<FileCode2 className="h-5 w-5" />} title="No prompts yet" description="Open any lead and click “Generate website prompt”, or select several leads and generate prompts in bulk." action={<ButtonLink href="/leads">Go to leads</ButtonLink>} /></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {prompts.map((p) => (
            <Link key={p.id} href={`/prompts/${p.id}`} className="card group p-5 transition-colors hover:border-faint/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold group-hover:text-accent">{p.business.name}</div>
                  <div className="text-xs text-muted">{p.business.city ?? "—"}</div>
                </div>
                <Badge tone={(p.qualityScore ?? 0) >= 85 ? "green" : "amber"}>{p.qualityScore ?? "—"}/100</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                <span>v{p.currentVersion}</span>
                <span>{(p.versions[0]?.wordCount ?? 0).toLocaleString()} words</span>
                <span>{p.versions[0]?.generator === "AI" ? "AI-enhanced" : p.versions[0]?.generator === "MANUAL" ? "Edited" : "Rule-based"}</span>
                <span>{timeAgo(p.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
