import { pageContext } from "@/lib/server/page";
import { TYPE_GROUPS, emailAudience, emailSetup, listEmailRuns } from "@/lib/server/email/runs";
import { emailReplies } from "@/lib/server/email/replies";
import { EmailsComposer } from "@/components/emails/composer";

export const metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext();
  const { tab } = await searchParams;
  const [leads, setup, runs, replies] = await Promise.all([emailAudience(ctx.workspace.id), emailSetup(ctx.workspace.id), listEmailRuns(ctx.workspace.id), emailReplies(ctx.workspace.id)]);
  const data = { leads, setup, runs, replies, groups: TYPE_GROUPS.map((g) => ({ id: g.id, label: g.label })) };
  return <EmailsComposer initial={JSON.parse(JSON.stringify(data))} canSend={ctx.can("emails.send")} initialTab={tab === "replies" ? "replies" : "send"} />;
}
