"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

export function InboxActions({ accounts }: { accounts: { id: string; provider: string }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!accounts.length) return null;
  return (
    <Button variant="outline" loading={busy} loadingText="Checking inbox…" onClick={async () => {
      setBusy(true);
      try {
        const msgs: string[] = [];
        for (const a of accounts) { const r = await apiFetch<{ message: string }>(`/api/email-accounts/${a.id}/sync`, { body: {} }); msgs.push(r.message); }
        kickJobs();
        toast.info("Inbox check", msgs.join(" "));
        setTimeout(() => router.refresh(), 4000);
      } catch (e) { toast.error("Inbox check failed", (e as Error).message); } finally { setBusy(false); }
    }}>
      <RefreshCw className="h-4 w-4" /> Check inbox
    </Button>
  );
}
