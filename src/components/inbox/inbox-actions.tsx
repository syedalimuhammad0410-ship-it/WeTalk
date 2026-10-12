"use client";
import { useState } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

export function InboxActions({ accounts }: { accounts: { id: string; provider: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<"sync" | "clean" | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" loading={busy === "clean"} loadingText="Starting…" title="Move spam, newsletters and other emails unrelated to your agency into Filtered" onClick={async () => {
        setBusy("clean");
        try {
          await apiFetch("/api/inbox/cleanup", { body: {} });
          kickJobs();
          toast.info("Cleaning up inbox", "Unmatched emails are being checked; unrelated ones move to “Filtered”. Progress shows in the jobs tray.");
          setTimeout(() => router.refresh(), 6000);
        } catch (e) { toast.error("Clean-up failed", (e as Error).message); } finally { setBusy(null); }
      }}>
        <Filter className="h-4 w-4" /> Clean up inbox
      </Button>
      {accounts.length > 0 && (
        <Button variant="outline" loading={busy === "sync"} loadingText="Checking inbox…" onClick={async () => {
          setBusy("sync");
          try {
            const msgs: string[] = [];
            for (const a of accounts) { const r = await apiFetch<{ message: string }>(`/api/email-accounts/${a.id}/sync`, { body: {} }); msgs.push(r.message); }
            kickJobs();
            toast.info("Inbox check", msgs.join(" "));
            setTimeout(() => router.refresh(), 4000);
          } catch (e) { toast.error("Inbox check failed", (e as Error).message); } finally { setBusy(null); }
        }}>
          <RefreshCw className="h-4 w-4" /> Check inbox
        </Button>
      )}
    </div>
  );
}
