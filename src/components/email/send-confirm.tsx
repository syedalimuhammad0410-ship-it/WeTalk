"use client";
import { FlaskConical } from "lucide-react";
import { ConfirmDialog } from "../ui/dialog";
import { Alert } from "../ui/misc";

export type SendSummary = { recipient: string; subject: string; message: string; business: string | null; source: string; campaign: string | null; from: string; provider: string; sandbox: boolean };

/** Shows exactly what will be sent before any outreach email goes out. */
export function SendConfirmDialog({ summary, open, onClose, onConfirm, loading }: { summary: SendSummary | null; open: boolean; onClose: () => void; onConfirm: () => void; loading?: boolean }) {
  return (
    <ConfirmDialog open={open} onClose={onClose} onConfirm={onConfirm} loading={loading} tone="primary" title="Confirm and send" confirmLabel={summary?.sandbox ? "Send (sandbox)" : "Send email"}>
      {summary && (
        <div className="space-y-3 text-sm">
          {summary.sandbox && <Alert tone="info" title={<span className="inline-flex items-center gap-1.5"><FlaskConical className="h-4 w-4" /> SANDBOX — this email will be recorded but not delivered.</span>} />}
          <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Recipient</dt><dd className="break-all font-medium">{summary.recipient}</dd>
            <dt className="text-muted">From</dt><dd className="break-all">{summary.from}</dd>
            <dt className="text-muted">Business</dt><dd>{summary.business ?? "—"}</dd>
            <dt className="text-muted">Source</dt><dd className="text-xs">{summary.source}</dd>
            <dt className="text-muted">Campaign</dt><dd>{summary.campaign ?? "None"}</dd>
            <dt className="text-muted">Subject</dt><dd className="font-medium">{summary.subject}</dd>
          </dl>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-subtle p-3 font-sans text-[13px] leading-relaxed">{summary.message}</pre>
          <p className="text-xs text-muted">Your signature and compliance footer (unsubscribe line, address) are appended automatically.</p>
        </div>
      )}
    </ConfirmDialog>
  );
}
