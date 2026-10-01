import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Home, BookOpen, Target, MessageCircle, Camera, Network, Wand2, ClipboardCheck, Mic, CalendarDays, ListChecks, Sun, Trophy, Library, Users, Settings, Shield, Search, Bell, ChevronDown, LogOut, UserPlus, MoreHorizontal, X, WifiOff, Repeat,
} from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { post, get } from '../lib/api.ts';
import { onOpenTutor, openTutor, type TutorContext } from '../lib/tutorBus.ts';
import { Logo } from './Logo.tsx';
import { TutorChat } from './TutorChat.tsx';
import { CommandPalette } from './CommandPalette.tsx';
import { Celebrations } from './Celebrations.tsx';
import { cx } from './ui.tsx';

type Item = { to: string; label: string; icon: typeof Home; early?: boolean };
const PRIMARY: Item[] = [
  { to: '/', label: 'Home', icon: Home, early: true }, { to: '/learn', label: 'Learn', icon: BookOpen, early: true }, { to: '/practice', label: 'Practice', icon: Target, early: true },
  { to: '/tutor', label: 'Tutor', icon: MessageCircle, early: true }, { to: '/homework', label: 'Homework Helper', icon: Camera },
];
const SECONDARY: Item[] = [
  { to: '/skills', label: 'Skill Tree', icon: Network, early: true }, { to: '/learn-anything', label: 'Learn Anything', icon: Wand2 }, { to: '/test-prep', label: 'Test Prep', icon: ClipboardCheck },
  { to: '/presentation', label: 'Presentation', icon: Mic }, { to: '/planner', label: 'Study Planner', icon: CalendarDays }, { to: '/organizer', label: 'Homework Organizer', icon: ListChecks },
  { to: '/daily', label: 'Daily Challenge', icon: Sun, early: true }, { to: '/progress', label: 'Progress & Badges', icon: Trophy, early: true }, { to: '/resources', label: 'Resources', icon: Library },
  { to: '/family', label: 'Parent / Teacher', icon: Users }, { to: '/settings', label: 'Settings', icon: Settings, early: true },
];

export function Layout() {
  const { profile, user } = useApp();
  const loc = useLocation();
  const [tutor, setTutor] = useState<TutorContext | null>(null);
  const [search, setSearch] = useState(false);
  const [more, setMore] = useState(false);
  const early = profile?.ageBand === 'early';
  const admin = user && ['moderator', 'admin', 'super_admin'].includes(user.role);
  const secondary = [...(early ? SECONDARY.filter((s) => s.early) : SECONDARY), ...(admin ? [{ to: '/admin', label: 'Admin', icon: Shield }] : [])];
  const primary = early ? PRIMARY.filter((p) => p.early) : PRIMARY;

  useEffect(() => onOpenTutor((c) => setTutor(c)), []);
  useEffect(() => { setMore(false); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  // Learning-time heartbeat while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') post('/me/activity', { seconds: 60 }).catch(() => {}); }, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-dvh lg:pl-72">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-border bg-surface/80 px-4 py-5 backdrop-blur lg:flex" aria-label="Main navigation">
        <NavLink to="/" className="mb-6 px-2"><Logo /></NavLink>
        <nav className="scrollbar-thin -mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
          {primary.map((i) => <NavItem key={i.to} item={i} />)}
          <div className="px-3 pb-1 pt-4 text-xs font-bold uppercase tracking-wider text-muted">Explore</div>
          {secondary.map((i) => <NavItem key={i.to} item={i} />)}
        </nav>
        <ProfileSwitcher />
      </aside>

      <TopBar onSearch={() => setSearch(true)} />
      <OfflineBanner />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 lg:px-10 lg:pb-12 lg:pt-6">
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          <Outlet />
        </motion.div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border px-2 pt-1.5 lg:hidden" aria-label="Main navigation">
        <div className="mx-auto flex max-w-lg justify-around">
          {primary.slice(0, 4).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => cx('flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold', isActive ? 'text-accent' : 'text-muted')}>
              <i.icon className="h-6 w-6" aria-hidden />{i.label.split(' ')[0]}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-muted" aria-label="More"><MoreHorizontal className="h-6 w-6" />More</button>
        </div>
      </nav>
      <AnimatePresence>
        {more && (
          <motion.div className="fixed inset-0 z-40 bg-black/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)}>
            <motion.div className="card safe-bottom absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-b-none p-4" initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="More">
              <div className="mb-3 flex items-center justify-between"><p className="font-bold">Explore</p><button onClick={() => setMore(false)} aria-label="Close" className="rounded-xl p-2 hover:bg-surface-2"><X className="h-5 w-5" /></button></div>
              <div className="grid grid-cols-3 gap-2">
                {[...primary.slice(4), ...secondary].map((i) => <NavLink key={i.to} to={i.to} className="flex flex-col items-center gap-1.5 rounded-2xl bg-surface-2 p-3 text-center text-xs font-semibold"><i.icon className="h-6 w-6 text-accent" />{i.label}</NavLink>)}
              </div>
              <div className="mt-4"><ProfileSwitcher /></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating tutor button */}
      {!loc.pathname.startsWith('/tutor') && (
        <button onClick={() => openTutor({})} className="bg-brand fixed bottom-24 right-4 z-30 flex h-14 items-center gap-2 rounded-full px-5 font-semibold text-white shadow-xl transition hover:scale-105 lg:bottom-6 lg:right-6" aria-label="Ask Math Tutor">
          <MessageCircle className="h-5 w-5" /><span className="hidden sm:inline">Ask Math Tutor</span>
        </button>
      )}
      <AnimatePresence>
        {tutor && (
          <motion.div className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTutor(null)}>
            <motion.aside className="card absolute inset-y-0 right-0 flex w-full max-w-md flex-col rounded-none border-y-0 border-r-0 sm:rounded-l-[var(--radius)]" initial={{ x: 480 }} animate={{ x: 0 }} exit={{ x: 480 }} transition={{ type: 'spring', stiffness: 280, damping: 30 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Math Tutor">
              <button onClick={() => setTutor(null)} className="absolute right-3 top-3 z-10 rounded-xl p-2 text-muted hover:bg-surface-2" aria-label="Close tutor"><X className="h-5 w-5" /></button>
              <TutorChat context={tutor} className="h-full pt-1" autoPrompt={tutor.prompt} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <CommandPalette open={search} onClose={() => setSearch(false)} />
      <Celebrations />
    </div>
  );
}

function NavItem({ item }: { item: Item }) {
  return (
    <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.93rem] font-semibold transition', isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')}>
      <item.icon className="h-5 w-5" aria-hidden />{item.label}
    </NavLink>
  );
}

function TopBar({ onSearch }: { onSearch: () => void }) {
  const { profile } = useApp();
  const nav = useNavigate();
  const [unread, setUnread] = useState(0);
  const loc = useLocation();
  useEffect(() => { get<{ notifications: { read: number }[] }>('/me/notifications').then((r) => setUnread(r.notifications.filter((n) => !n.read).length)).catch(() => {}); }, [loc.pathname]);
  return (
    <header className="glass sticky top-0 z-20 border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-10">
        <NavLink to="/" className="lg:hidden"><Logo size={32} showText={false} /></NavLink>
        <button onClick={onSearch} className="flex h-11 flex-1 items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 text-left text-muted transition hover:border-accent/50 sm:max-w-md" aria-label="Search courses, lessons, topics and resources">
          <Search className="h-4.5 w-4.5" /><span className="truncate text-sm">Search lessons, topics, resources…</span><kbd className="ml-auto hidden rounded-md border border-border px-1.5 text-[11px] sm:block">⌘K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {profile && <span className="hidden items-center gap-1 rounded-full bg-warn-soft px-3 py-1.5 text-sm font-bold text-warn sm:flex" title="Learning streak"><span className="flame">🔥</span>{profile.streak}</span>}
          {profile && <span className="hidden rounded-full bg-accent-soft px-3 py-1.5 text-sm font-bold text-accent sm:block" title="XP">{profile.xp.toLocaleString()} XP</span>}
          <button onClick={() => nav('/notifications')} className="relative rounded-xl p-2.5 text-muted hover:bg-surface-2" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
            <Bell className="h-5 w-5" />{unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}
          </button>
          <button onClick={() => nav('/profiles')} className="grid h-10 w-10 place-items-center rounded-2xl text-xl lg:hidden" style={{ background: profile?.color ? `${profile.color}22` : undefined }} aria-label="Switch profile">{profile?.avatar ?? '🙂'}</button>
        </div>
      </div>
    </header>
  );
}

export function ProfileSwitcher() {
  const { profile, profiles, selectProfile, user, setUser, refreshUser } = useApp();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-2.5 text-left hover:bg-surface-2" aria-expanded={open} aria-haspopup="menu">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-2xl" style={{ background: `${profile?.color ?? '#6366f1'}22` }}>{profile?.avatar}</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-bold">{profile?.name}</span><span className="block truncate text-xs text-muted">{user?.isGuest ? 'Guest · this device' : user?.email}</span></span>
        <ChevronDown className={cx('h-4 w-4 text-muted transition', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="card absolute bottom-full left-0 right-0 z-40 mb-2 p-2">
            {profiles.map((p) => (
              <button key={p.id} role="menuitem" onClick={() => { selectProfile(p.id); setOpen(false); nav('/'); }} className={cx('flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-surface-2', p.id === profile?.id && 'bg-accent-soft')}>
                <span className="text-2xl">{p.avatar}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}</span><span className="block text-xs text-muted">{p.schoolLabel}</span></span>
                {p.id === profile?.id && <span className="text-xs font-bold text-accent">Active</span>}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button role="menuitem" onClick={() => { setOpen(false); nav('/profiles'); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-sm font-semibold hover:bg-surface-2"><Repeat className="h-4 w-4" />Manage profiles</button>
            {user?.isGuest && <button role="menuitem" onClick={() => { setOpen(false); nav('/auth?mode=register'); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-sm font-semibold text-accent hover:bg-surface-2"><UserPlus className="h-4 w-4" />Create an account to save progress</button>}
            {!user?.isGuest && <button role="menuitem" onClick={async () => { await post('/auth/logout'); setUser(null); selectProfile(null); await refreshUser(); nav('/welcome'); }} className="flex w-full items-center gap-2 rounded-xl p-2 text-sm font-semibold hover:bg-surface-2"><LogOut className="h-4 w-4" />Sign out</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function OfflineBanner() {
  const { online } = useApp();
  if (online) return null;
  return <div className="flex items-center justify-center gap-2 bg-warn-soft px-4 py-2 text-sm font-semibold text-warn" role="status"><WifiOff className="h-4 w-4" />You’re offline. Your saved lessons remain available.</div>;
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-bg p-4">{children}</div>;
}
