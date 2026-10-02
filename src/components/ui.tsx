"use client";
import { clsx, type ClassValue } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Confidence, EvidenceKind, Strength } from "@/lib/types";

export const cn = (...c: ClassValue[]) => clsx(c);

type Variant = "primary" | "ghost" | "outline" | "danger" | "subtle";
export function Button({ variant = "outline", size = "md", className, loading, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-7 px-2.5 text-[12px]",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-12 px-6 text-[14px] tracking-wide",
        variant === "primary" && "bg-fg text-ink hover:bg-white",
        variant === "outline" && "border border-line-strong bg-white/[0.02] text-fg hover:border-white/25 hover:bg-white/[0.05]",
        variant === "ghost" && "text-dim hover:bg-white/[0.05] hover:text-fg",
        variant === "subtle" && "bg-white/[0.05] text-fg hover:bg-white/[0.09]",
        variant === "danger" && "border border-alert/40 bg-alert/10 text-alert hover:bg-alert/20",
        className,
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("label-mono text-mute", className)}>{children}</div>;
}

export function Panel({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-card border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="label-mono text-dim">{title}</div>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

const confStyle: Record<Confidence, string> = {
  high: "border-ok/40 bg-ok/10 text-ok",
  moderate: "border-cyan/40 bg-cyan/10 text-cyan",
  low: "border-warn/40 bg-warn/10 text-warn",
  insufficient: "border-white/15 bg-white/5 text-dim",
};
export function ConfidenceBadge({ value, className }: { value?: Confidence; className?: string }) {
  if (!value) return null;
  return <span className={cn("label-mono inline-flex items-center rounded-[3px] border px-1.5 py-0.5 !text-[9.5px]", confStyle[value], className)}>{value === "insufficient" ? "insufficient evidence" : `${value} confidence`}</span>;
}

const kindStyle: Record<EvidenceKind, string> = {
  direct: "border-ok/35 text-ok",
  indirect: "border-cyan/35 text-cyan",
  inference: "border-violet-400/35 text-violet-300",
  user: "border-warn/40 text-warn",
};
const kindLabel: Record<EvidenceKind, string> = { direct: "Direct evidence", indirect: "Indirect evidence", inference: "Inference", user: "User-provided" };
export function KindBadge({ kind }: { kind: EvidenceKind }) {
  return <span className={cn("label-mono inline-flex shrink-0 items-center rounded-[3px] border bg-black/20 px-1.5 py-0.5 !text-[9px]", kindStyle[kind])}>{kindLabel[kind]}</span>;
}

export function StrengthDots({ value }: { value: Strength | "none" }) {
  const n = value === "strong" ? 3 : value === "moderate" ? 2 : value === "weak" ? 1 : 0;
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} strength`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i < n ? "bg-cyan" : "bg-white/12")} />
      ))}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-cyan", className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="text-mute">{icon}</div>}
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {children && <div className="max-w-md text-[13px] leading-relaxed text-dim">{children}</div>}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button, input, textarea, select")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn("max-h-[90dvh] w-full overflow-auto rounded-card border border-line-strong bg-panel shadow-2xl", wide ? "max-w-4xl" : "max-w-md")}
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-[14px] font-semibold">{title}</h2>
              <button aria-label="Close" onClick={onClose} className="rounded p-1 text-dim hover:bg-white/5 hover:text-fg">
                <X className="size-4" />
              </button>
            </header>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-dim">
      <span>{label}</span>
      <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("relative h-5 w-9 rounded-full border transition-colors", checked ? "border-cyan/50 bg-cyan/25" : "border-line-strong bg-white/5")}>
        <span className={cn("absolute top-0.5 size-3.5 rounded-full transition-all", checked ? "left-[18px] bg-cyan" : "left-0.5 bg-dim")} />
      </button>
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono text-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-mute">{hint}</span>}
    </label>
  );
}

export const inputCls = "h-9 w-full rounded-[5px] border border-line-strong bg-black/30 px-3 text-[13px] text-fg placeholder:text-mute focus:border-cyan/60 focus:outline-none";
