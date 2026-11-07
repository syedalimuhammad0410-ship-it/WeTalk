import { db } from "@/lib/db";
import { readUnsubscribeToken } from "@/lib/server/email/unsubscribe";

export const metadata = { title: "Unsubscribe" };

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const t = readUnsubscribeToken(token);
  const company = t ? await db.companyProfile.findUnique({ where: { workspaceId: t.workspaceId }, select: { companyName: true } }) : null;
  const sender = company?.companyName || "the sender";
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        {!t ? (
          <>
            <h1 className="text-xl font-semibold">Link not recognised</h1>
            <p className="mt-2 text-sm text-muted">This unsubscribe link is incomplete or invalid. Reply to the email with “unsubscribe” and you will be removed.</p>
          </>
        ) : done ? (
          <>
            <h1 className="text-xl font-semibold">You&apos;re unsubscribed</h1>
            <p className="mt-2 text-sm text-muted"><strong>{t.email}</strong> will not receive further emails from {sender}.</p>
          </>
        ) : (
          <form method="post" action="/api/unsubscribe">
            <h1 className="text-xl font-semibold">Unsubscribe</h1>
            <p className="mt-2 text-sm text-muted">Stop all emails from {sender} to <strong>{t.email}</strong>?</p>
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg">Unsubscribe</button>
          </form>
        )}
      </div>
    </main>
  );
}
