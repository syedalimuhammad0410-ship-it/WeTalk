import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageContext } from "@/lib/server/page";
import { FEATURES } from "@/lib/server/intel/features";
import { QUALITY_LABELS } from "@/lib/server/prompts/quality";
import { PromptEditor } from "@/components/prompts/prompt-editor";

export const metadata = { title: "Prompt editor" };

export default async function PromptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const prompt = await db.generatedPrompt.findFirst({
    where: { id, workspaceId: ctx.workspace.id },
    include: { business: { select: { id: true, name: true } }, versions: { orderBy: { version: "desc" }, select: { id: true, version: true, changeType: true, generator: true, qualityScore: true, qualityBreakdown: true, wordCount: true, note: true, createdAt: true, content: true } } },
  });
  if (!prompt) notFound();
  const opp = await db.opportunity.findFirst({ where: { businessId: prompt.businessId }, orderBy: { createdAt: "desc" }, select: { recommendedFeatures: true } });
  const options = (prompt.options ?? {}) as { addFeatures?: string[]; removeFeatures?: string[] };
  const included = new Set([...((opp?.recommendedFeatures ?? []) as { key: string }[]).map((f) => f.key), ...(options.addFeatures ?? [])].filter((k) => !(options.removeFeatures ?? []).includes(k)));
  return (
    <PromptEditor
      prompt={JSON.parse(JSON.stringify({ id: prompt.id, title: prompt.title, currentVersion: prompt.currentVersion, business: prompt.business, versions: prompt.versions }))}
      features={Object.values(FEATURES).map((f) => ({ key: f.key, name: f.name, included: included.has(f.key) }))}
      qualityLabels={QUALITY_LABELS}
      canEdit={ctx.can("prompts.edit")}
    />
  );
}
