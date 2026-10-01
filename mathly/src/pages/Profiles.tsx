import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Pencil, Trash2, Cloud, LogOut, Lock } from 'lucide-react';
import { AVATARS, PROFILE_COLORS, levelLabel } from '../../shared/curriculum.ts';
import type { ProfileSummary } from '../../shared/types.ts';
import { useApp } from '../lib/store.tsx';
import { post, patch, del, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Logo } from '../components/Logo.tsx';
import { Button, Input, Modal, cx } from '../components/ui.tsx';

export default function Profiles() {
  const { profiles, selectProfile, refreshProfiles, user, setUser, refreshUser } = useApp();
  const nav = useNavigate();
  const [creating, setCreating] = useState(profiles.length === 0);
  const [editing, setEditing] = useState<ProfileSummary | null>(null);
  const [manage, setManage] = useState(false);
  const [pinFor, setPinFor] = useState<ProfileSummary | null>(null);

  const open = (p: ProfileSummary) => { selectProfile(p.id); nav(p.onboarded ? '/' : '/onboarding'); };
  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between"><Logo /><div className="flex gap-2">
          {user?.isGuest ? <Button variant="soft" size="sm" icon={<Cloud className="h-4 w-4" />} onClick={() => nav('/auth?mode=register')}>Save progress to an account</Button>
            : <Button variant="ghost" size="sm" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await post('/auth/logout'); setUser(null); selectProfile(null); await refreshUser(); nav('/welcome'); }}>Sign out</Button>}
        </div></header>
        <h1 className="text-center text-3xl font-extrabold sm:text-4xl">Who’s learning?</h1>
        <p className="mt-2 text-center text-muted">Each learner has their own level, progress, XP and achievements.</p>
        <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
          <AnimatePresence>
            {profiles.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="relative">
                <button onClick={() => (manage ? setEditing(p) : open(p))} className="group flex w-full flex-col items-center gap-3 rounded-[var(--radius)] p-4 transition hover:bg-surface" aria-label={`${manage ? 'Edit' : 'Open'} ${p.name}`}>
                  <span className="grid h-24 w-24 place-items-center rounded-[1.75rem] text-5xl shadow-sm ring-4 ring-transparent transition group-hover:scale-105 group-hover:ring-accent/30" style={{ background: `${p.color}26` }}>{p.avatar}</span>
                  <span className="text-center"><span className="block font-bold">{p.name}</span><span className="block text-xs text-muted">{p.schoolLabel}{p.learningLevel != null ? ` · Level ${levelLabel(p.learningLevel).replace('Grade ', 'G')}` : ''}</span></span>
                  {p.hasPin && <Lock className="absolute right-4 top-4 h-4 w-4 text-muted" aria-label="Protected by parental PIN" />}
                  {manage && <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface shadow"><Pencil className="h-4 w-4" /></span>}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {profiles.length < 8 && (
            <button onClick={() => setCreating(true)} className="flex flex-col items-center gap-3 rounded-[var(--radius)] p-4 hover:bg-surface" aria-label="Add a learner profile">
              <span className="grid h-24 w-24 place-items-center rounded-[1.75rem] border-2 border-dashed border-border text-muted"><Plus className="h-8 w-8" /></span>
              <span className="font-semibold text-muted">Add learner</span>
            </button>
          )}
        </div>
        {profiles.length > 0 && <div className="mt-10 text-center"><Button variant="secondary" onClick={() => setManage((m) => !m)}>{manage ? 'Done' : 'Manage profiles'}</Button></div>}
      </div>
      <ProfileEditor open={creating} onClose={() => setCreating(false)} onSaved={async (p) => { await refreshProfiles(); setCreating(false); selectProfile(p.id); nav('/onboarding'); }} />
      {editing && <ProfileEditor open profile={editing} onClose={() => setEditing(null)} onSaved={async () => { await refreshProfiles(); setEditing(null); }} onDelete={() => { setPinFor(editing); }} />}
      <DeleteProfile profile={pinFor} onClose={() => setPinFor(null)} onDeleted={async () => { setPinFor(null); setEditing(null); selectProfile(null); await refreshProfiles(); }} />
    </div>
  );
}

function ProfileEditor({ open, onClose, onSaved, profile, onDelete }: { open: boolean; onClose: () => void; onSaved: (p: ProfileSummary) => void; profile?: ProfileSummary; onDelete?: () => void }) {
  const [name, setName] = useState(profile?.name ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[0]);
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[0]);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = profile ? await patch<{ profile: ProfileSummary }>(`/profiles/${profile.id}`, { name, avatar, color }) : await post<{ profile: ProfileSummary }>('/profiles', { name, avatar, color });
      onSaved(r.profile);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={profile ? 'Edit profile' : 'New learner'}>
      <div className="mb-5 flex justify-center"><span className="grid h-24 w-24 place-items-center rounded-[1.75rem] text-5xl" style={{ background: `${color}26` }}>{avatar}</span></div>
      <Input label="What should we call you?" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="First name or nickname" autoFocus />
      <p className="mt-4 text-sm font-semibold">Avatar</p>
      <div className="mt-2 grid grid-cols-9 gap-1.5">{AVATARS.map((a) => <button key={a} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`} aria-pressed={avatar === a} className={cx('grid aspect-square place-items-center rounded-xl text-2xl transition', avatar === a ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-surface-2')}>{a}</button>)}</div>
      <p className="mt-4 text-sm font-semibold">Color</p>
      <div className="mt-2 flex gap-2">{PROFILE_COLORS.map((c) => <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c} className={cx('h-9 w-9 rounded-full ring-offset-2 ring-offset-surface', color === c && 'ring-2 ring-text')} style={{ background: c }} />)}</div>
      <p className="mt-4 text-xs text-muted">Only a first name or nickname is needed — no other personal information.</p>
      <div className="mt-6 flex items-center gap-2">
        {profile && onDelete && <Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>Delete</Button>}
        <div className="ml-auto flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!name.trim()} onClick={save}>{profile ? 'Save' : 'Continue'}</Button></div>
      </div>
    </Modal>
  );
}

function DeleteProfile({ profile, onClose, onDeleted }: { profile: ProfileSummary | null; onClose: () => void; onDeleted: () => void }) {
  const [pin, setPin] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!profile} onClose={onClose} title={`Delete ${profile?.name}?`}>
      <p className="text-sm text-muted">This permanently deletes this learner’s progress, XP, courses and history. You can export their data from Settings first.</p>
      {profile?.hasPin && <div className="mt-4"><Input label="Parental PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></div>}
      <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); try { await del(`/profiles/${profile!.id}`, { pin }); toast('Profile deleted', 'success'); onDeleted(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } }}>Delete forever</Button></div>
    </Modal>
  );
}
