"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "lucide-react";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

export function AuditAllButton({ ids }: { ids: string[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  return (
    <Button loading={busy} disabled={started} onClick={async () => { setBusy(true); try { await apiFetch("/api/leads/bulk", { body: { action: "audit", ids } }); kickJobs(); setStarted(true); toast.success(`Analysing ${ids.length} websites in the background`); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>
      <Gauge className="h-4 w-4" /> {started ? "Analysis running…" : `Analyze ${ids.length} unaudited`}
    </Button>
  );
}
