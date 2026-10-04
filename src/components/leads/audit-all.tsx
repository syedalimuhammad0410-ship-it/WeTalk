"use client";
import { useState } from "react";
import { Gauge } from "lucide-react";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { apiFetch } from "@/lib/client";
import { kickJobs } from "../shell/job-tray";

export function AuditAllButton({ ids }: { ids: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button loading={busy} onClick={async () => { setBusy(true); try { await apiFetch("/api/leads/bulk", { body: { action: "audit", ids } }); kickJobs(); toast.success(`Analysing ${ids.length} websites in the background`); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>
      <Gauge className="h-4 w-4" /> Analyze {ids.length} unaudited
    </Button>
  );
}
