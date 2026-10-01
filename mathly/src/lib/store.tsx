import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileSummary } from '../../shared/types.ts';
import { ApiError, get, post, setApiProfile } from './api.ts';
import { applyDisplayPrefs } from './theme.ts';

export interface User { id: string; email: string | null; displayName: string | null; role: string; isGuest: boolean }
interface AppState {
  ready: boolean;
  user: User | null;
  providers: { google: boolean; microsoft: boolean; apple: boolean };
  aiConfigured: boolean;
  profiles: ProfileSummary[];
  profile: ProfileSummary | null;
  prefs: Record<string, unknown>;
  online: boolean;
  setUser: (u: User | null) => void;
  refreshUser: () => Promise<void>;
  refreshProfiles: () => Promise<ProfileSummary[]>;
  selectProfile: (id: string | null) => void;
  setPrefs: (p: Record<string, unknown>) => void;
  continueAsGuest: () => Promise<void>;
}
const Ctx = createContext<AppState | null>(null);
const KEY = 'mathly.profile';
const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ } };

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [providers, setProviders] = useState({ google: false, microsoft: false, apple: false });
  const [aiConfigured, setAi] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState<string | null>(() => safeGet(KEY));
  const [prefs, setPrefsState] = useState<Record<string, unknown>>({});
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const refreshProfiles = useCallback(async () => {
    const r = await get<{ profiles: ProfileSummary[] }>('/profiles');
    setProfiles(r.profiles);
    return r.profiles;
  }, []);

  const refreshUser = useCallback(async () => {
    const [me, cfg] = await Promise.all([get<{ user: User | null; providers: AppState['providers'] }>('/auth/me'), get<{ ai: { configured: boolean } }>('/config')]);
    setUser(me.user); setProviders(me.providers); setAi(cfg.ai.configured);
    if (me.user) {
      const ps = await refreshProfiles();
      setProfileId((cur) => (cur && ps.some((p) => p.id === cur) ? cur : null));
    } else { setProfiles([]); setProfileId(null); }
  }, [refreshProfiles]);

  useEffect(() => {
    refreshUser().catch(() => { /* offline on boot: show what we can */ }).finally(() => setReady(true));
    const on = () => setOnline(true), off = () => setOnline(false);
    const unauth = () => { setUser(null); setProfiles([]); };
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('mathly:unauthenticated', unauth);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('mathly:unauthenticated', unauth); };
  }, [refreshUser]);

  useEffect(() => {
    setApiProfile(profileId); safeSet(KEY, profileId);
    if (!profileId) { setPrefsState({}); return; }
    get<{ preferences: Record<string, unknown> }>('/me/preferences').then((r) => { setPrefsState(r.preferences); applyDisplayPrefs(r.preferences); }).catch((e) => { if (e instanceof ApiError && e.code === 'no_profile') setProfileId(null); });
  }, [profileId]);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId]);
  useEffect(() => { document.documentElement.dataset.age = profile?.ageBand ?? 'secondary'; }, [profile?.ageBand]);

  const value: AppState = {
    ready, user, providers, aiConfigured, profiles, profile, prefs, online, setUser, refreshUser, refreshProfiles,
    selectProfile: (id) => { setApiProfile(id); setProfileId(id); },
    setPrefs: (p) => { setPrefsState(p); applyDisplayPrefs(p); },
    continueAsGuest: async () => { const r = await post<{ user: User }>('/auth/guest'); setUser(r.user); await refreshProfiles(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

/** Small data-fetching hook with loading/error/refresh. */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true); setError(null);
    get<T>(path, ctrl.signal).then((d) => { setData(d); setLoading(false); }).catch((e) => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
