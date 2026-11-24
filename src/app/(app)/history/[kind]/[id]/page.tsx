import { notFound } from "next/navigation";
import { pageContext } from "@/lib/server/page";
import { AppError } from "@/lib/server/errors";
import { searchReplay, type HistoryKind } from "@/lib/server/history";
import { SearchReplay } from "@/components/history/replay";

export const metadata = { title: "Search replay" };
export const dynamic = "force-dynamic";

const KINDS: HistoryKind[] = ["claude", "search", "autoprospect"];
const LIVE: Record<HistoryKind, (id: string) => string> = { claude: (id) => `/claude/live/${id}`, search: (id) => `/discover/live/${id}`, autoprospect: (id) => `/autoprospect/${id}` };

export default async function ReplayPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await pageContext();
  const { kind, id } = await params;
  if (!KINDS.includes(kind as HistoryKind)) notFound();
  const data = await searchReplay(ctx.workspace.id, kind as HistoryKind, id).catch((e: unknown) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!data) notFound();
  return <SearchReplay data={JSON.parse(JSON.stringify(data))} liveHref={LIVE[kind as HistoryKind](id)} />;
}
