"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "@/lib/client";
import { cn, timeAgo } from "@/lib/utils";
import { RelTime, DateTimeText } from "@/components/ui/time";

type N = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string; type: string };

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: N[]; unread: number }>({ items: [], unread: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => apiFetch<{ items: N[]; unread: number }>("/api/notifications").then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    await apiFetch("/api/notifications/read", { body }).catch(() => {});
    load();
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen((v) => !v); if (!open) load(); }} className="relative rounded-lg p-2 text-muted transition-colors hover:bg-subtle hover:text-fg" aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ""}`} aria-expanded={open}>
        <Bell className="h-[18px] w-[18px]" />
        {data.unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-14 z-50 animate-fade-in rounded-xl border border-border bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {data.unread > 0 && (
              <button onClick={() => markRead({ all: true })} className="flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {data.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">You&apos;re all caught up.</li>}
            {data.items.map((n) => (
              <li key={n.id} className={cn("border-b border-border last:border-0", !n.readAt && "bg-accent/[0.04]")}>
                <Link href={n.link ?? "#"} onClick={() => { if (!n.readAt) markRead({ ids: [n.id] }); setOpen(false); }} className="flex gap-3 px-4 py-3 hover:bg-subtle">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-faint"><RelTime d={n.createdAt} /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
