"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Clock3, FolderSearch, LogOut, Map, Menu, Network, Plus, Settings, ShieldCheck, Terminal, BookMarked, X } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "./ui";
import { useWorkspace, ws, type Tab } from "@/lib/client/store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const invId = useWorkspace((s) => s.inv?.id);
  const tab = useWorkspace((s) => s.tab);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((j) => setUser(j.user));
  }, []);
  useEffect(() => setOpen(false), [path]);

  const goTab = (t: Tab) => {
    if (invId) {
      ws.set({ tab: t });
      if (!path.startsWith(`/app/i/${invId}`)) router.push(`/app/i/${invId}`);
    } else router.push("/app/investigations");
  };
  const inWs = path.startsWith("/app/i/");
  const items: { label: string; icon: typeof Plus; href?: string; tab?: Tab; active: boolean }[] = [
    { label: "New Investigation", icon: Plus, href: "/app", active: path === "/app" },
    { label: "Investigations", icon: FolderSearch, href: "/app/investigations", active: path === "/app/investigations" },
    { label: "Evidence", icon: Network, tab: "board", active: inWs && tab === "board" },
    { label: "Maps", icon: Map, tab: "map", active: inWs && tab === "map" },
    { label: "Sources", icon: BookMarked, tab: "sources", active: inWs && tab === "sources" },
    { label: "Timeline", icon: Clock3, tab: "timeline", active: inWs && tab === "timeline" },
    { label: "Settings", icon: Settings, href: "/app/settings", active: path === "/app/settings" },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
      {items.map((it) =>
        it.href ? (
          <Link key={it.label} href={it.href} className={cn("flex items-center gap-3 rounded-[5px] px-3 py-2 text-[13px] transition-colors", it.active ? "bg-white/[0.07] text-fg" : "text-dim hover:bg-white/[0.04] hover:text-fg")}>
            <it.icon className={cn("size-4", it.label === "New Investigation" && "text-cyan")} />
            {it.label}
          </Link>
        ) : (
          <button key={it.label} onClick={() => goTab(it.tab!)} className={cn("flex items-center gap-3 rounded-[5px] px-3 py-2 text-left text-[13px] transition-colors", it.active ? "bg-white/[0.07] text-fg" : "text-dim hover:bg-white/[0.04] hover:text-fg", !invId && "opacity-60")} title={invId ? undefined : "Open an investigation first"}>
            <it.icon className="size-4" />
            {it.label}
          </button>
        ),
      )}
      <div className="my-3 h-px bg-line" />
      <Link href="/app/admin" className={cn("flex items-center gap-3 rounded-[5px] px-3 py-2 text-[13px]", path === "/app/admin" ? "bg-white/[0.07] text-fg" : "text-mute hover:text-fg")}>
        <Terminal className="size-4" /> Debug & usage
      </Link>
      <Link href="/privacy" className="flex items-center gap-3 rounded-[5px] px-3 py-2 text-[13px] text-mute hover:text-fg">
        <ShieldCheck className="size-4" /> Privacy & Responsible Research
      </Link>
    </nav>
  );

  const footer = (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-2.5 px-1">
        <div className="grid size-7 place-items-center rounded-full bg-cyan/15 text-[11px] font-semibold text-cyan">{(user?.name || "?").replace(/^Mr\.? /, "").slice(0, 1)}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px]">{user?.name || "…"}</div>
          <div className="truncate text-[11px] text-mute">{user?.email}</div>
        </div>
        <button
          aria-label="Sign out"
          title="Sign out"
          className="rounded p-1.5 text-mute hover:bg-white/5 hover:text-fg"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="px-5 py-5">
          <Logo href="/app" />
        </div>
        {nav}
        {footer}
      </aside>
      {/* mobile */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-panel/95 px-3 backdrop-blur md:hidden">
        <Logo href="/app" />
        <button aria-label="Open menu" onClick={() => setOpen(true)} className="rounded p-2 text-dim">
          <Menu className="size-5" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="relative flex w-[260px] flex-col border-r border-line bg-panel">
            <div className="flex items-center justify-between px-4 py-4">
              <Logo href="/app" />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="p-1 text-dim">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col pt-12 md:pt-0">{children}</div>
    </div>
  );
}
