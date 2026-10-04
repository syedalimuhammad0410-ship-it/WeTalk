"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; tone: "success" | "error" | "info"; title: string; body?: string };
const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === "error" ? 9000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-pop", t.tone === "error" ? "border-red-500/30" : "border-border")} role={t.tone === "error" ? "alert" : "status"}>
            {t.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : t.tone === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 break-words text-[13px] text-muted">{t.body}</p>}
            </div>
            <button className="text-faint hover:text-fg" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return {
    success: (title: string, body?: string) => c.push({ tone: "success", title, body }),
    error: (title: string, body?: string) => c.push({ tone: "error", title, body }),
    info: (title: string, body?: string) => c.push({ tone: "info", title, body }),
  };
}
