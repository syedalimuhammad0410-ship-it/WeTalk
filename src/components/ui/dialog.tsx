"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Accessible modal: focus trap, Esc to close, restores focus, scroll lock. */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute("disabled"));
    setTimeout(() => (focusables().find((x) => x.dataset.autofocus !== undefined) ?? focusables()[0])?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} className={cn("relative flex max-h-[92vh] w-full animate-fade-in flex-col rounded-t-2xl border border-border bg-surface shadow-pop sm:rounded-2xl", { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-faint hover:bg-subtle hover:text-fg" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", tone = "danger", loading, children, confirmDisabled }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; description?: React.ReactNode; confirmLabel?: string; tone?: "danger" | "primary"; loading?: boolean; children?: React.ReactNode; confirmDisabled?: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm text-muted">{description}</div>}
      {children}
    </Dialog>
  );
}
