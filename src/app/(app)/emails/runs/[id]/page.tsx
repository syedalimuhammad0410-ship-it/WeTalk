import { notFound } from "next/navigation";
import { pageContext } from "@/lib/server/page";
import { AppError } from "@/lib/server/errors";
import { emailRunState } from "@/lib/server/email/runs";
import { EmailRunLive } from "@/components/emails/run-live";

export const metadata = { title: "Emailing live" };
export const dynamic = "force-dynamic";

export default async function EmailRunPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext();
  const { id } = await params;
  const state = await emailRunState(ctx.workspace.id, id).catch((e: unknown) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!state) notFound();
  return <EmailRunLive initial={JSON.parse(JSON.stringify(state))} canControl={ctx.can("emails.send")} />;
}
