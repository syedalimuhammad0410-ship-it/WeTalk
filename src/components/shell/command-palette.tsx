"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileCode2, Mail, Megaphone, Search, StickyNote, User } from "lucide-react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/client";
import { NAV } from "./nav";

type Results = {
  businesses: { id: string; name: string; city: string | null }[];
  contacts: { id: string; name: string | null; email: string | null; businessId: string; business: { name: string } }[];
  emails: { id: string; subject: string; conversationId: string | null; business: { name: string } | null }[];
  campaigns: { id: string; name: string }[];
  prompts: { id: string; title: string }[];
  notes: { id: string; body: string; businessId: string; business: { name: string } }[];
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ("");
      setRes(null);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        setRes(await apiFetch<Results>(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }));
        setCursor(0);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180); // debounce
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const items = useMemo(() => {
    const out: { key: string; icon: React.ReactNode; label: string; sub?: string; href: string; group: string }[] = [];
    if (!res) {
      for (const n of NAV.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()))) out.push({ key: n.href, icon: <n.icon className="h-4 w-4" />, label: n.label, href: n.href, group: "Go to" });
      return out;
    }
    res.businesses.forEach((b) => out.push({ key: `b${b.id}`, icon: <Building2 className="h-4 w-4" />, label: b.name, sub: b.city ?? undefined, href: `/leads/${b.id}`, group: "Businesses" }));
    res.contacts.forEach((c) => out.push({ key: `c${c.id}`, icon: <User className="h-4 w-4" />, label: c.name ?? c.email ?? "Contact", sub: c.business.name, href: `/leads/${c.businessId}`, group: "Contacts" }));
    res.emails.forEach((e) => out.push({ key: `e${e.id}`, icon: <Mail className="h-4 w-4" />, label: e.subject, sub: e.business?.name, href: e.conversationId ? `/inbox/${e.conversationId}` : "/inbox", group: "Emails" }));
    res.campaigns.forEach((c) => out.push({ key: `m${c.id}`, icon: <Megaphone className="h-4 w-4" />, label: c.name, href: `/campaigns/${c.id}`, group: "Campaigns" }));
    res.prompts.forEach((p) => out.push({ key: `p${p.id}`, icon: <FileCode2 className="h-4 w-4" />, label: p.title, href: `/prompts/${p.id}`, group: "Prompts" }));
    res.notes.forEach((n) => out.push({ key: `n${n.id}`, icon: <StickyNote className="h-4 w-4" />, label: n.body.slice(0, 80), sub: n.business.name, href: `/leads/${n.businessId}?tab=notes`, group: "Notes" }));
    return out;
  }, [res, q]);

  if (!open || typeof document === "undefined") return null;
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-start justify-center px-3 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-xl animate-fade-in overflow-hidden rounded-2xl border border-border bg-surface shadow-pop">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              if (e.key === "Enter" && items[cursor]) go(items[cursor]!.href);
            }}
            placeholder="Search businesses, contacts, emails, campaigns, prompts, notes…"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
          />
          {loading && <span className="text-xs text-faint">Searching…</span>}
        </div>
        <ul id="cmdk-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {res && items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">No results for “{q}”.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.key} role="option" aria-selected={i === cursor}>
                {header && <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-faint">{header}</div>}
                <button onMouseEnter={() => setCursor(i)} onClick={() => go(it.href)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === cursor ? "bg-subtle" : ""}`}>
                  <span className="text-muted">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.sub && <span className="truncate text-xs text-faint">{it.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
