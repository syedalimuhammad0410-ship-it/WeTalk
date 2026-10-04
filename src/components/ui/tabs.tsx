"use client";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Accessible tabs (roving tabindex, arrow keys). Controlled. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" className={cn("scrollbar-thin -mb-px flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              const n = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              refs.current[n]?.focus();
              onChange(tabs[n]!.id);
            }
          }}
          className={cn("relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors", value === t.id ? "text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:text-fg")}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", value === t.id ? "bg-accent/10 text-accent" : "bg-subtle text-muted")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
