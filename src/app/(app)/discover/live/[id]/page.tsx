import { notFound } from "next/navigation";
import { pageContext } from "@/lib/server/page";
import { liveState } from "@/lib/server/live";
import { AppError } from "@/lib/server/errors";
import { InvestigationView } from "@/components/live/investigation-view";

export const metadata = { title: "Live search" };
export const dynamic = "force-dynamic";

export default async function SearchLivePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const state = await liveState(ctx.workspace.id, "search", id).catch((e: unknown) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!state) notFound();
  return <InvestigationView initial={JSON.parse(JSON.stringify(state))} canControl={ctx.can("discovery.run")} />;
}
