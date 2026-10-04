"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronsUpDown, LifeBuoy, LogOut, Menu, Plus, ShieldCheck, UserCircle2, X, Search, MoreHorizontal, Check, FlaskConical } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { apiFetch } from "@/lib/client";
import { NAV } from "./nav";
import { Wordmark } from "./logo";
import { NotificationsMenu } from "./notifications";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";
import { JobTray } from "./job-tray";
import { ROLE_LABEL, type RoleT } from "@/lib/permissions";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/form";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";

export type ShellProps = {
  user: { name: string; email: string; isSystemAdmin: boolean };
  workspace: { id: string; name: string; isDemo: boolean };
  role: RoleT;
  workspaces: { id: string; name: string; isDemo: boolean; role: RoleT }[];
  counts: { inbox: number; followups: number };
  sandbox: boolean;
  children: React.ReactNode;
};

export function AppShell(p: ShellProps) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <Sidebar {...p} />
      </aside>
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-xs animate-fade-in">
            <Sidebar {...p} onClose={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/80 px-3 backdrop-blur sm:px-6">
        <button className="rounded-lg p-2 text-muted hover:bg-subtle lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>
        <button onClick={() => setPalette(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-faint shadow-sm transition-colors hover:border-faint/40 sm:max-w-md" aria-label="Search (Ctrl+K)">
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search businesses, emails, campaigns…</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <JobTray />
          <ThemeToggle />
          <NotificationsMenu />
        </div>
      </header>
      {(p.workspace.isDemo || p.sandbox) && (
        <div className={cn("flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium", p.workspace.isDemo ? "bg-amber-400/15 text-amber-800 dark:text-amber-200" : "bg-sky-500/10 text-sky-800 dark:text-sky-200")} role="status">
          <FlaskConical className="h-3.5 w-3.5" />
          {p.workspace.isDemo ? "DEMO DATA — this workspace contains sample businesses. Nothing here is real and no email is delivered." : "Email SANDBOX is the default sender — emails are recorded but NOT delivered. Connect Gmail or Postmark to send for real."}
        </div>
      )}
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
        {p.children}
      </main>
      <MobileNav counts={p.counts} onMore={() => setDrawer(true)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function Sidebar({ user, workspace, role, workspaces, counts, onClose }: ShellProps & { onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [wsOpen, setWsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  async function switchTo(id: string) {
    await apiFetch("/api/workspaces/switch", { body: { workspaceId: id } });
    setWsOpen(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-fg">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/dashboard" className="rounded-md">
          <Wordmark />
        </Link>
        {onClose && (
          <button onClick={onClose} className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-active" aria-label="Close navigation">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Main">
        {NAV.map((item) => {
          const Icon = item.icon;
          const count = item.badge ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn("group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors", active(item.href) ? "bg-sidebar-active text-white" : "text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-fg")}
            >
              <Icon className={cn("h-[18px] w-[18px]", active(item.href) ? "text-indigo-300" : "text-sidebar-muted group-hover:text-sidebar-fg")} />
              {item.label}
              {count > 0 && <span className="ml-auto rounded-full bg-indigo-500/90 px-1.5 text-[11px] font-semibold tabular-nums text-white">{count > 99 ? "99+" : count}</span>}
            </Link>
          );
        })}
        {(role === "OWNER" || role === "ADMIN" || user.isSystemAdmin) && (
          <Link href="/admin" aria-current={active("/admin") ? "page" : undefined} className={cn("mt-3 flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors", active("/admin") ? "bg-sidebar-active text-white" : "text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-fg")}>
            <ShieldCheck className="h-[18px] w-[18px]" />
            Admin
          </Link>
        )}
      </nav>
      <div className="space-y-0.5 border-t border-sidebar-border p-3">
        <div className="relative">
          <button onClick={() => setWsOpen((v) => !v)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-sidebar-fg" aria-expanded={wsOpen} aria-haspopup="menu">
            <Building2 className="h-[18px] w-[18px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sidebar-fg">{workspace.name}</span>
              <span className="block text-[11px]">Workspace · {ROLE_LABEL[role]}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4" />
          </button>
          {wsOpen && (
            <div role="menu" className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border border-sidebar-border bg-[#1a1a1f] p-1 shadow-pop">
              {workspaces.map((w) => (
                <button key={w.id} role="menuitem" onClick={() => switchTo(w.id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-fg hover:bg-sidebar-active">
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.isDemo && <span className="rounded bg-amber-400/20 px-1 text-[10px] font-semibold text-amber-200">DEMO</span>}
                  {w.id === workspace.id && <Check className="h-4 w-4 text-indigo-300" />}
                </button>
              ))}
              <button role="menuitem" onClick={() => { setCreating(true); setWsOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-fg">
                <Plus className="h-4 w-4" /> New workspace
              </button>
            </div>
          )}
        </div>
        <Link href="/settings/account" className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-sidebar-fg">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-indigo-500/80 text-[9px] font-semibold text-white">{initials(user.name)}</span>
          <span className="min-w-0 flex-1 truncate">Account</span>
          <UserCircle2 className="h-4 w-4 opacity-0" aria-hidden />
        </Link>
        <Link href="/help" className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-sidebar-fg">
          <LifeBuoy className="h-[18px] w-[18px]" /> Help
        </Link>
        <button
          onClick={async () => {
            await apiFetch("/api/auth/logout", { body: {} }).catch(() => {});
            router.push("/login");
            router.refresh();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] text-sidebar-muted transition-colors hover:bg-sidebar-active/60 hover:text-sidebar-fg"
        >
          <LogOut className="h-[18px] w-[18px]" /> Sign Out
        </button>
      </div>
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="New workspace"
        description="Workspaces keep leads, settings and email accounts completely separate."
        footer={
          <>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await apiFetch("/api/workspaces", { body: { name: newName } });
                  setCreating(false);
                  router.push("/onboarding");
                  router.refresh();
                } catch (e) {
                  toast.error("Could not create workspace", (e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Create workspace
            </Button>
          </>
        }
      >
        <Field label="Workspace name" htmlFor="new-ws">
          <Input id="new-ws" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Pixel & Pine Studio" data-autofocus />
        </Field>
      </Dialog>
    </div>
  );
}

function MobileNav({ counts, onMore }: { counts: ShellProps["counts"]; onMore: () => void }) {
  const pathname = usePathname();
  const items = [NAV[0]!, NAV[1]!, NAV[2]!, NAV[5]!];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Primary mobile">
      {items.map((i) => {
        const Icon = i.icon;
        const on = pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", on ? "text-accent" : "text-muted")}>
            <Icon className="h-5 w-5" />
            {i.label.replace("Find Businesses", "Find")}
            {i.badge && counts[i.badge] > 0 && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-accent" aria-label="new" />}
          </Link>
        );
      })}
      <button onClick={onMore} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted">
        <MoreHorizontal className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}
