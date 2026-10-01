import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Lock, Monitor, Moon, Sun, Trash2, ShieldCheck } from 'lucide-react';
import { ACCENT_THEMES, AVATARS, CURRICULA, SCHOOL_LEVELS, UNLOCKS } from '../../shared/curriculum.ts';
import { useApp } from '../lib/store.tsx';
import { patch, post, del, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { getTheme, setTheme, type ThemeMode } from '../lib/theme.ts';
import { Button, Card, Chip, Input, Modal, PageHeader, Select, Toggle, cx } from '../components/ui.tsx';

const NOTIF = [{ id: 'daily_goal', l: 'Daily goal reminders' }, { id: 'test', l: 'Upcoming tests' }, { id: 'review', l: 'Review reminders' }, { id: 'homework', l: 'Homework due dates' }, { id: 'achievement', l: 'Achievements' }];

export default function Settings() {
  const { profile, prefs, setPrefs, refreshProfiles, user, setUser, selectProfile, refreshUser } = useApp();
  const nav = useNavigate();
  const [unlocked, setUnlocked] = useState(!profile?.hasPin);
  const [pinTry, setPinTry] = useState('');
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [name, setName] = useState(profile?.name ?? '');
  const [pinModal, setPinModal] = useState(false);
  const [delAcct, setDelAcct] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  useEffect(() => { setName(profile?.name ?? ''); }, [profile?.name]);
  if (!profile) return null;

  async function savePref(p: Record<string, unknown>) {
    const next = { ...prefs, ...p }; setPrefs(next);
    try { await patch('/me/preferences', p); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function saveProfile(p: Record<string, unknown>) {
    try { await patch(`/profiles/${profile!.id}`, p); await refreshProfiles(); toast('Saved', 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const avatars = [...AVATARS, ...UNLOCKS.filter((u) => u.kind === 'avatar' && profile.level >= u.level).map((u) => u.id)];

  if (!unlocked) return (
    <Card className="mx-auto mt-10 max-w-sm p-6 text-center">
      <Lock className="mx-auto h-10 w-10 text-accent" />
      <h1 className="mt-3 text-xl font-bold">Settings are protected</h1>
      <p className="mt-1 text-sm text-muted">Enter the parental PIN to change settings for {profile.name}.</p>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await post<{ ok: boolean }>(`/profiles/${profile.id}/verify-pin`, { pin: pinTry }); if (r.ok) setUnlocked(true); else toast('That PIN isn’t right.', 'error'); }} className="mt-4 space-y-3"><Input type="password" inputMode="numeric" value={pinTry} onChange={(e) => setPinTry(e.target.value)} aria-label="Parental PIN" /><Button type="submit" className="w-full">Unlock</Button></form>
    </Card>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-bold">Profile</h2>
        <div className="flex gap-2"><div className="flex-1"><Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div><Button className="self-end" variant="secondary" disabled={!name.trim() || name === profile.name} onClick={() => saveProfile({ name })}>Save</Button></div>
        <div><p className="mb-2 text-sm font-semibold">Avatar</p><div className="flex flex-wrap gap-1.5">{avatars.map((a) => <button key={a} onClick={() => saveProfile({ avatar: a })} aria-pressed={profile.avatar === a} className={cx('grid h-11 w-11 place-items-center rounded-xl text-2xl', profile.avatar === a ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-2')}>{a}</button>)}</div></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="School level" value={String(profile.schoolGrade ?? '')} onChange={(v) => saveProfile({ schoolGrade: v === '' ? null : Number(v) })} options={[{ value: '', label: 'Not set' }, ...SCHOOL_LEVELS.map((l) => ({ value: String(l.value), label: l.label }))]} />
          <Select label="Curriculum" value={profile.curriculum} onChange={(v) => saveProfile({ curriculum: v })} options={CURRICULA.map((c) => ({ value: c.id, label: `${c.flag} ${c.label}` }))} />
          <Select label="Daily goal" value={String(profile.dailyGoalMin)} onChange={(v) => saveProfile({ dailyGoalMin: Number(v) })} options={[10, 15, 20, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} minutes` }))} />
        </div>
        <Button variant="soft" onClick={() => nav('/placement')}>Retake placement check</Button>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-bold">Appearance & accessibility</h2>
        <div className="flex flex-wrap gap-2">{([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'System']] as const).map(([m, I, l]) => <Chip key={m} selected={theme === m} onClick={() => { setTheme(m); setThemeState(m); savePref({ theme: m }); }}><I className="mr-1.5 inline h-4 w-4" />{l}</Chip>)}</div>
        <div><p className="mb-2 text-sm font-semibold">Accent theme</p><div className="flex flex-wrap gap-2">{Object.entries(ACCENT_THEMES).map(([id, t]) => { const locked = profile.level < t.minLevel; return <button key={id} disabled={locked} onClick={() => savePref({ accent: id })} aria-pressed={(prefs.accent ?? 'default') === id} className={cx('flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold', (prefs.accent ?? 'default') === id ? 'border-accent ring-2 ring-accent/30' : 'border-border', locked && 'opacity-50')}><span className="h-5 w-5 rounded-full" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` }} />{t.label}{locked && <span className="text-xs text-muted">Lv {t.minLevel}</span>}</button>; })}</div></div>
        <div><p className="mb-2 text-sm font-semibold">Text size</p><div className="flex gap-2">{[['normal', 'Default'], ['large', 'Large'], ['xlarge', 'Extra large']].map(([v, l]) => <Chip key={v} selected={(prefs.textSize ?? 'normal') === v} onClick={() => savePref({ textSize: v })}>{l}</Chip>)}</div></div>
        <Toggle checked={prefs.highContrast === true} onChange={(v) => savePref({ highContrast: v })} label="High contrast" />
        <Toggle checked={prefs.reducedMotion === true} onChange={(v) => savePref({ reducedMotion: v })} label="Reduce motion" description="Turns off animations and confetti." />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Learning</h2>
        <Toggle checked={prefs.learningMode !== false} onChange={(v) => savePref({ learningMode: v })} label="Learning Mode" description="The tutor helps you understand without immediately giving the answer. You can still ask for full solutions to review." />
        <Toggle checked={prefs.voiceReplies === true} onChange={(v) => savePref({ voiceReplies: v })} label="Read tutor replies aloud" />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-bold">Notifications</h2>
        <Toggle checked={(prefs.notifications as Record<string, boolean> | undefined)?.all !== false} onChange={(v) => savePref({ notifications: { ...(prefs.notifications as object), all: v } })} label="All notifications" />
        {NOTIF.map((n) => <Toggle key={n.id} checked={(prefs.notifications as Record<string, boolean> | undefined)?.[n.id] !== false} onChange={(v) => savePref({ notifications: { ...(prefs.notifications as object), [n.id]: v } })} label={n.l} />)}
        {'Notification' in window && <Toggle checked={prefs.browserNotifications === true} onChange={async (v) => { if (v) { const perm = await Notification.requestPermission(); if (perm !== 'granted') return toast('Notifications are blocked in your browser settings.', 'error'); } savePref({ browserNotifications: v }); }} label="Show browser notifications" description="Pop-up reminders while Mathly is open." />}
      </Card>

      <Card className="space-y-2 p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5 text-success" />Privacy & parental controls</h2>
        <Toggle checked={prefs.saveTutorHistory !== false} onChange={(v) => savePref({ saveTutorHistory: v })} label="Save tutor chat history" description="When off, chats are not stored after you leave." />
        <Toggle checked={prefs.analyticsOptOut !== true} onChange={(v) => savePref({ analyticsOptOut: !v })} label="Share anonymous usage statistics" description="Counts only (e.g. “a lesson was completed”) — never your answers or chats." />
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => { window.location.href = `/api/profiles/${profile.id}/export`; }}>Export {profile.name}’s data</Button>
          <Button variant="secondary" icon={<Lock className="h-4 w-4" />} onClick={() => setPinModal(true)}>{profile.hasPin ? 'Change / remove parental PIN' : 'Set parental PIN'}</Button>
          <Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => nav('/profiles')}>Delete this profile…</Button>
        </div>
        <p className="pt-2 text-xs text-muted">Mathly never sells educational data and only stores what’s needed to run the app.</p>
      </Card>

      <Card className="space-y-4 p-6">
        <h2 className="text-lg font-bold">Account</h2>
        {user?.isGuest ? (
          <div className="rounded-2xl bg-accent-soft p-4"><p className="font-semibold">You’re using Mathly as a guest on this device.</p><p className="text-sm text-muted">Create an account to save progress across devices — all profiles come with you.</p><Link to="/auth?mode=register"><Button className="mt-3">Create an account</Button></Link></div>
        ) : (
          <>
            <p className="text-sm">Signed in as <strong>{user?.email}</strong></p>
            <form onSubmit={async (e) => { e.preventDefault(); try { await post('/auth/change-password', pw); toast('Password updated', 'success'); setPw({ current: '', next: '' }); } catch (err) { toast(errMsg(err), 'error'); } }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Input type="password" label="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
              <Input type="password" label="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
              <Button type="submit" variant="secondary" className="self-end" disabled={!pw.current || pw.next.length < 8}>Update</Button>
            </form>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {!user?.isGuest && <Button variant="secondary" onClick={async () => { await post('/auth/logout'); setUser(null); selectProfile(null); await refreshUser(); nav('/welcome'); }}>Sign out</Button>}
          <Button variant="ghost" className="text-danger" onClick={() => setDelAcct(true)}>Delete {user?.isGuest ? 'all guest data' : 'account'}</Button>
          <Link to="/setup"><Button variant="ghost">Integration status</Button></Link>
        </div>
      </Card>
      <PinModal open={pinModal} onClose={() => setPinModal(false)} hasPin={profile.hasPin} profileId={profile.id} onDone={refreshProfiles} />
      <DeleteAccount open={delAcct} onClose={() => setDelAcct(false)} onDone={async () => { setUser(null); selectProfile(null); await refreshUser(); nav('/welcome'); }} />
    </div>
  );
}

function PinModal({ open, onClose, hasPin, profileId, onDone }: { open: boolean; onClose: () => void; hasPin: boolean; profileId: string; onDone: () => Promise<unknown> }) {
  const [cur, setCur] = useState(''); const [pin, setPin] = useState('');
  async function save(remove = false) {
    try { await post(`/profiles/${profileId}/pin`, { pin: remove ? null : pin, current: cur }); toast(remove ? 'PIN removed' : 'PIN saved', 'success'); setCur(''); setPin(''); await onDone(); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Parental PIN">
      <p className="mb-4 text-sm text-muted">A PIN protects this profile’s settings and prevents it from being deleted without permission.</p>
      <div className="space-y-3">
        {hasPin && <Input label="Current PIN" type="password" inputMode="numeric" value={cur} onChange={(e) => setCur(e.target.value)} />}
        <Input label="New PIN (4–6 digits)" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </div>
      <div className="mt-5 flex justify-end gap-2">{hasPin && <Button variant="ghost" className="text-danger" onClick={() => save(true)}>Remove PIN</Button>}<Button disabled={pin.length < 4} onClick={() => save()}>Save PIN</Button></div>
    </Modal>
  );
}

function DeleteAccount({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [txt, setTxt] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Delete everything?">
      <p className="text-sm text-muted">This permanently deletes the account and every learner profile, with all progress, courses, homework and history. This can’t be undone. Consider exporting each profile’s data first.</p>
      <div className="mt-4"><Input label="Type DELETE to confirm" value={txt} onChange={(e) => setTxt(e.target.value)} /></div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={txt !== 'DELETE'} onClick={async () => { try { await del('/auth/account', { confirm: 'DELETE' }); onDone(); } catch (e) { toast(errMsg(e), 'error'); } }}>Delete forever</Button></div>
    </Modal>
  );
}
