import { pageContext } from "@/lib/server/page";
import { leadsPerDay, searchHistory } from "@/lib/server/history";
import { SearchHistoryView } from "@/components/history/search-history";

export const metadata = { title: "Search History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const ctx = await pageContext();
  const [rows, days] = await Promise.all([searchHistory(ctx.workspace.id), leadsPerDay(ctx.workspace.id)]);
  return <SearchHistoryView rows={JSON.parse(JSON.stringify(rows))} days={days} />;
}
