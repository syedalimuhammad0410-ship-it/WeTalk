import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Trash2, Check, X, Plus } from 'lucide-react';
import { SKILLS } from '../../shared/skills.ts';
import { useApp, useFetch } from '../lib/store.tsx';
import { patch, post, put, del, errMsg } from '../lib/api.ts';
import { toast } from '../lib/celebrate.ts';
import { Badge, Button, Card, Input, Modal, PageHeader, PageSkeleton, Select, Stat, Tabs, Textarea, Toggle, cx } from '../components/ui.tsx';

type Tab = 'overview' | 'users' | 'courses' | 'requests' | 'flags' | 'rules' | 'resources' | 'analytics' | 'audit';

export default function Admin() {
  const { user } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  if (!user || !['moderator', 'admin', 'super_admin'].includes(user.role)) return <Navigate to="/" replace />;
  const isAdmin = user.role === 'admin' || user.role === 'super_admin';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, ...(isAdmin ? [{ id: 'users' as Tab, label: 'Users' }] : []), { id: 'courses', label: 'Courses' }, { id: 'requests', label: 'Topic requests' }, { id: 'flags', label: 'Flagged' },
    ...(isAdmin ? [{ id: 'rules' as Tab, label: 'XP & achievements' }, { id: 'resources' as Tab, label: 'Resources' }, { id: 'analytics' as Tab, label: 'Analytics' }, { id: 'audit' as Tab, label: 'Audit log' }] : []),
  ];
  return (
    <div>
      <PageHeader icon={<Shield className="h-7 w-7 text-accent" />} title="Admin" subtitle={`Signed in as ${user.email} · ${user.role.replace('_', ' ')}`} />
      <div className="mb-6"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'overview' && <Overview />}{tab === 'users' && <Users />}{tab === 'courses' && <Courses />}{tab === 'requests' && <Requests />}
      {tab === 'flags' && <Flags />}{tab === 'rules' && <Rules />}{tab === 'resources' && <ResourcesAdmin />}{tab === 'analytics' && <Analytics />}{tab === 'audit' && <Audit />}
    </div>
  );
}

function Overview() {
  const { data } = useFetch<{ counts: Record<string, number>; health: { status: string; uptimeSec: number; memoryMb: number; dbSizeKb: number; node: string; ai: { configured: boolean; model: string | null }; oauth: Record<string, boolean>; env: string } }>('/admin/overview');
  if (!data) return <PageSkeleton />;
  const c = data.counts; const h = data.health;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Accounts" value={c.accounts} icon="👤" sub={`${c.guests} guests`} /><Stat label="Learner profiles" value={c.profiles} icon="🧒" /><Stat label="Active today" value={c.activeToday} icon="⚡" sub={`${c.active7} this week`} /><Stat label="Questions answered" value={c.questions.toLocaleString()} icon="✅" />
        <Stat label="Lessons completed" value={c.lessons} icon="📚" /><Stat label="Custom courses" value={c.customCourses} icon="✨" sub={`${c.pendingCourses} AI courses to review`} /><Stat label="Topic requests" value={c.topicRequests} icon="📮" /><Stat label="Open flags" value={c.openFlags} icon="🚩" />
      </div>
      <Card className="p-5">
        <h2 className="font-bold">System health</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div><Badge tone="success">● {h.status}</Badge> <span className="text-muted">{h.env}</span></div>
          <div>Uptime: <strong>{Math.floor(h.uptimeSec / 3600)}h {Math.floor((h.uptimeSec % 3600) / 60)}m</strong></div>
          <div>Memory: <strong>{h.memoryMb} MB</strong> · DB: <strong>{h.dbSizeKb} KB</strong></div>
          <div>Node: <strong>{h.node}</strong></div>
          <div>AI: {h.ai.configured ? <Badge tone="success">{h.ai.model}</Badge> : <Badge>built-in engines</Badge>}</div>
          <div>OAuth: {Object.entries(h.oauth).map(([k, v]) => <Badge key={k} tone={v ? 'success' : 'neutral'} className="mr-1">{k}</Badge>)}</div>
        </div>
      </Card>
    </div>
  );
}

function Users() {
  const { user } = useApp();
  const { data, reload } = useFetch<{ users: { id: string; email: string | null; display_name: string | null; role: string; is_guest: number; disabled: number; created_at: string; last_login_at: string | null; profiles: number }[]; roles: string[] }>('/admin/users');
  const [q, setQ] = useState('');
  if (!data) return <PageSkeleton />;
  const list = data.users.filter((u) => !q || `${u.email} ${u.display_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card className="overflow-x-auto p-4">
      <div className="mb-3 max-w-sm"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" aria-label="Search users" /></div>
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="p-2">User</th><th className="p-2">Role</th><th className="p-2">Profiles</th><th className="p-2">Joined</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
        <tbody>{list.map((u) => (
          <tr key={u.id} className="border-t border-border">
            <td className="p-2"><div className="font-semibold">{u.email ?? 'Guest (device)'}</div><div className="text-xs text-muted">{u.display_name}</div></td>
            <td className="p-2">{u.is_guest || u.id === user?.id ? <Badge>{u.role}</Badge> : <select value={u.role} onChange={async (e) => { try { await patch(`/admin/users/${u.id}`, { role: e.target.value }); toast('Role updated', 'success'); reload(); } catch (err) { toast(errMsg(err), 'error'); } }} className="rounded-lg border border-border bg-surface px-2 py-1" aria-label="Role">{data.roles.map((r) => <option key={r}>{r}</option>)}</select>}</td>
            <td className="p-2">{u.profiles}</td>
            <td className="p-2 text-muted">{u.created_at.slice(0, 10)}</td>
            <td className="p-2">{u.disabled ? <Badge tone="danger">Disabled</Badge> : <Badge tone="success">Active</Badge>}</td>
            <td className="p-2 text-right">{u.id !== user?.id && <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={async () => { try { await patch(`/admin/users/${u.id}`, { disabled: !u.disabled }); reload(); } catch (err) { toast(errMsg(err), 'error'); } }}>{u.disabled ? 'Enable' : 'Disable'}</Button><Button size="sm" variant="ghost" className="text-danger" aria-label="Delete user" onClick={async () => { if (!confirm('Delete this user and all their profiles?')) return; try { await del(`/admin/users/${u.id}`); reload(); } catch (err) { toast(errMsg(err), 'error'); } }}><Trash2 className="h-4 w-4" /></Button></div>}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

interface AC { id: string; title: string; description: string; generatedBy: string; status: string; topic: string | null; createdAt: string; personal: boolean; units: { title: string; lessons: { id: string; title: string; skillId?: string; generated: { objective: string; explanation: string[]; practice: { prompt: string; answer: string; verify: string }[] } | null }[] }[]; validation: { checked: number; passed: number; rejected: string[] } | null; notes: string | null }
function Courses() {
  const { data, reload } = useFetch<{ courses: AC[] }>('/admin/courses');
  const [open, setOpen] = useState<AC | null>(null);
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  if (!data) return <PageSkeleton />;
  const list = data.courses.filter((c) => filter === 'all' || (c.generatedBy === 'ai' && c.status === 'personal'));
  const setStatus = async (id: string, status: string) => { try { await post(`/admin/courses/${id}/status`, { status }); toast(`Course ${status}`, 'success'); reload(); setOpen(null); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Tabs tabs={[{ id: 'review', label: 'AI courses to review' }, { id: 'all', label: 'All custom courses' }]} value={filter} onChange={setFilter} /><Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setCreate(true)}>Add catalog course</Button></div>
      {!list.length && <p className="text-sm text-muted">Nothing here right now.</p>}
      {list.map((c) => (
        <Card key={c.id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1"><p className="font-bold">{c.title}</p><p className="truncate text-sm text-muted">{c.topic ? `Requested: “${c.topic}” · ` : ''}{c.generatedBy} · {c.createdAt.slice(0, 10)}</p></div>
          <Badge tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'neutral'}>{c.status}</Badge>
          {c.validation && <Badge tone="accent">{c.validation.passed}/{c.validation.checked} verified</Badge>}
          <Button size="sm" variant="secondary" onClick={() => setOpen(c)}>Review</Button>
        </Card>
      ))}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.title} wide>
        {open && (
          <div className="space-y-4">
            {open.notes && <p className="text-sm text-muted">{open.notes}</p>}
            {open.units.map((u) => <div key={u.title}><p className="font-bold">{u.title}</p><ul className="mt-1 space-y-2 text-sm">{u.lessons.map((l) => <li key={l.id} className="rounded-xl bg-surface-2 p-3"><p className="font-semibold">{l.title} {l.skillId ? <Badge>curriculum skill</Badge> : <Badge tone="warn">AI lesson</Badge>}</p>{l.generated && <><p className="mt-1 text-muted">{l.generated.objective}</p><details className="mt-1"><summary className="cursor-pointer text-accent">Content & {l.generated.practice.length} questions</summary>{l.generated.explanation.map((p, i) => <p key={i} className="mt-1">{p}</p>)}<ul className="mt-2 list-disc pl-5">{l.generated.practice.map((q, i) => <li key={i}>{q.prompt} → <strong>{q.answer}</strong> <Badge>{q.verify}</Badge></li>)}</ul></details></>}</li>)}</ul></div>)}
            {open.validation?.rejected.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold">Rejected by validation ({open.validation.rejected.length})</summary><ul className="mt-1 list-disc pl-5 text-muted">{open.validation.rejected.map((r, i) => <li key={i}>{r}</li>)}</ul></details> : null}
            <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" className="text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={async () => { if (confirm('Delete course?')) { await del(`/admin/courses/${open.id}`); reload(); setOpen(null); } }}>Delete</Button><Button variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => setStatus(open.id, 'rejected')}>Reject</Button><Button icon={<Check className="h-4 w-4" />} onClick={() => setStatus(open.id, 'approved')}>Approve for catalog</Button></div>
          </div>
        )}
      </Modal>
      <CreateCourse open={create} onClose={() => setCreate(false)} onDone={() => { setCreate(false); reload(); }} />
    </div>
  );
}

function CreateCourse({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [band, setBand] = useState('All levels');
  const [units, setUnits] = useState<{ title: string; skills: string[] }[]>([{ title: 'Unit 1', skills: [] }]);
  return (
    <Modal open={open} onClose={onClose} title="Add a catalog course" wide>
      <div className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <Input label="Level band" value={band} onChange={(e) => setBand(e.target.value)} />
        {units.map((u, i) => (
          <Card key={i} className="space-y-2 p-3">
            <Input aria-label="Unit title" value={u.title} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Select value="" onChange={(v) => v && setUnits(units.map((x, j) => (j === i ? { ...x, skills: [...new Set([...x.skills, v])] } : x)))} options={[{ value: '', label: 'Add a skill…' }, ...SKILLS.map((s) => ({ value: s.id, label: `${s.title} (${s.domain})` }))]} />
            <div className="flex flex-wrap gap-1">{u.skills.map((s) => <button key={s} onClick={() => setUnits(units.map((x, j) => (j === i ? { ...x, skills: x.skills.filter((y) => y !== s) } : x)))}><Badge tone="accent">{SKILLS.find((x) => x.id === s)?.title} ✕</Badge></button>)}</div>
          </Card>
        ))}
        <div className="flex justify-between"><Button variant="ghost" onClick={() => setUnits([...units, { title: `Unit ${units.length + 1}`, skills: [] }])}>+ Unit</Button><Button disabled={!title.trim() || !units.some((u) => u.skills.length)} onClick={async () => { try { await post('/admin/courses', { title, description: desc, band, units }); toast('Course created', 'success'); onDone(); } catch (e) { toast(errMsg(e), 'error'); } }}>Create course</Button></div>
      </div>
    </Modal>
  );
}

function Requests() {
  const { data, reload } = useFetch<{ top: { topic: string; n: number; last: string }[]; recent: { id: string; topic: string; reason: string | null; level: string | null; style: string | null; status: string; course_id: string | null; created_at: string }[] }>('/admin/topic-requests');
  if (!data) return <PageSkeleton />;
  const max = Math.max(1, ...data.top.map((t) => t.n));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5"><h2 className="font-bold">Most requested topics</h2><ol className="mt-3 space-y-2">{data.top.map((t, i) => <li key={t.topic}><div className="flex justify-between text-sm"><span className="font-semibold">{i + 1}. {t.topic}</span><span className="text-muted">{t.n.toLocaleString()} request{t.n > 1 ? 's' : ''}</span></div><div className="mt-1 h-2 rounded-full bg-surface-2"><div className="bg-brand h-2 rounded-full" style={{ width: `${(t.n / max) * 100}%` }} /></div></li>)}</ol>{!data.top.length && <p className="text-sm text-muted">No requests yet.</p>}</Card>
      <Card className="p-5"><h2 className="font-bold">Recent requests</h2><ul className="mt-3 space-y-2">{data.recent.map((r) => <li key={r.id} className="rounded-xl bg-surface-2 p-3 text-sm"><div className="flex items-center gap-2"><span className="flex-1 font-semibold">{r.topic}</span><select value={r.status} onChange={async (e) => { await patch(`/admin/topic-requests/${r.id}`, { status: e.target.value }); reload(); }} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs" aria-label="Status">{['open', 'planned', 'done', 'declined'].map((s) => <option key={s}>{s}</option>)}</select></div>{r.reason && <p className="mt-1 text-muted">“{r.reason}”</p>}<p className="mt-1 text-xs text-muted">{[r.level, r.style].filter(Boolean).join(' · ')} · {r.created_at.slice(0, 10)}{r.course_id ? ' · path built' : ''}</p></li>)}</ul></Card>
    </div>
  );
}

function Flags() {
  const { data, reload } = useFetch<{ flags: { id: string; kind: string; ref: string | null; snapshot: { prompt?: string; answer?: string; steps?: string[] } | null; reason: string; status: string; created_at: string }[] }>('/admin/flags');
  if (!data) return <PageSkeleton />;
  if (!data.flags.length) return <p className="text-sm text-muted">No flagged content. 🎉</p>;
  return (
    <div className="space-y-3">{data.flags.map((f) => (
      <Card key={f.id} className={cx('p-4', f.status !== 'open' && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2"><Badge tone="warn">{f.kind}</Badge><Badge>{f.status}</Badge><span className="text-xs text-muted">{f.created_at}</span><div className="ml-auto flex gap-1"><Button size="sm" variant="secondary" onClick={async () => { await patch(`/admin/flags/${f.id}`, { status: 'resolved' }); reload(); }}>Resolve</Button><Button size="sm" variant="ghost" onClick={async () => { await patch(`/admin/flags/${f.id}`, { status: 'dismissed' }); reload(); }}>Dismiss</Button></div></div>
        <p className="mt-2 font-semibold">“{f.reason}”</p>
        {f.snapshot?.prompt && <div className="mt-2 rounded-xl bg-surface-2 p-3 text-sm"><p>{f.snapshot.prompt}</p><p className="mt-1">Answer key: <strong>{f.snapshot.answer}</strong></p></div>}
      </Card>
    ))}</div>
  );
}

function Rules() {
  const xp = useFetch<{ rules: Record<string, number>; labels: Record<string, string>; defaults: Record<string, number> }>('/admin/xp-rules');
  const ach = useFetch<{ achievements: { id: string; title: string; icon: string; xp: number; enabled: boolean; unlockedBy: number }[] }>('/admin/achievements');
  const [rules, setRules] = useState<Record<string, number> | null>(null);
  const r = rules ?? xp.data?.rules;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-bold">XP rules</h2><p className="text-sm text-muted">XP measures engagement — mastery is computed separately.</p>
        {r && xp.data && <div className="mt-4 space-y-2">{Object.keys(xp.data.defaults).map((k) => <div key={k} className="flex items-center gap-3"><label htmlFor={`xp-${k}`} className="flex-1 text-sm font-semibold">{xp.data!.labels[k]}</label><input id={`xp-${k}`} type="number" min={0} max={5000} value={r[k]} onChange={(e) => setRules({ ...r, [k]: Number(e.target.value) })} className="h-10 w-24 rounded-xl border border-border bg-surface px-3" /></div>)}<Button className="mt-2" onClick={async () => { try { await put('/admin/xp-rules', r); toast('XP rules saved', 'success'); } catch (e) { toast(errMsg(e), 'error'); } }}>Save XP rules</Button></div>}
      </Card>
      <Card className="p-5">
        <h2 className="font-bold">Achievements</h2>
        <div className="mt-3 divide-y divide-border">{ach.data?.achievements.map((a) => <div key={a.id} className="flex items-center gap-3 py-2"><span className="text-2xl">{a.icon}</span><div className="flex-1"><p className="text-sm font-semibold">{a.title}</p><p className="text-xs text-muted">Unlocked by {a.unlockedBy}</p></div><input type="number" aria-label={`${a.title} XP`} defaultValue={a.xp} min={0} className="h-9 w-20 rounded-lg border border-border bg-surface px-2" onBlur={async (e) => { await put(`/admin/achievements/${a.id}`, { xp: Number(e.target.value) }); }} /><Toggle checked={a.enabled} onChange={async (v) => { await put(`/admin/achievements/${a.id}`, { enabled: v }); ach.reload(); }} label="" /></div>)}</div>
      </Card>
    </div>
  );
}

function ResourcesAdmin() {
  const { data, reload } = useFetch<{ resources: { id: string; title: string; url: string; source: string; kind: string }[]; domains: string[] }>('/admin/resources');
  const [f, setF] = useState({ title: '', url: '', source: '', kind: 'article', domain: '', skillIds: [] as string[] });
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card className="p-4"><ul className="divide-y divide-border">{data?.resources.map((r) => <li key={r.id} className="flex items-center gap-3 py-2 text-sm"><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.title}</span><a href={r.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-accent">{r.url}</a></span><Badge>{r.kind}</Badge><Button size="sm" variant="ghost" className="text-danger" aria-label="Delete resource" onClick={async () => { await del(`/admin/resources/${r.id}`); reload(); }}><Trash2 className="h-4 w-4" /></Button></li>)}</ul></Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-bold">Add an external resource</h2>
        <p className="text-xs text-muted">Only add real resources you have checked. They are shown to learners labeled as external.</p>
        <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Input label="URL (https://…)" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <Input label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
        <Select label="Kind" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={['video', 'article', 'interactive', 'course', 'book', 'tool'].map((k) => ({ value: k, label: k }))} />
        <Select label="Area" value={f.domain} onChange={(v) => setF({ ...f, domain: v })} options={[{ value: '', label: '—' }, ...(data?.domains ?? []).map((d) => ({ value: d, label: d }))]} />
        <Select label="Related skill" value="" onChange={(v) => v && setF({ ...f, skillIds: [...new Set([...f.skillIds, v])] })} options={[{ value: '', label: 'Add skill…' }, ...SKILLS.map((s) => ({ value: s.id, label: s.title }))]} />
        <div className="flex flex-wrap gap-1">{f.skillIds.map((s) => <Badge key={s} tone="accent">{SKILLS.find((x) => x.id === s)?.title}</Badge>)}</div>
        <Button disabled={!f.title || !f.url || !f.source} onClick={async () => { try { await post('/admin/resources', f); toast('Resource added', 'success'); setF({ title: '', url: '', source: '', kind: 'article', domain: '', skillIds: [] }); reload(); } catch (e) { toast(errMsg(e), 'error'); } }}>Add resource</Button>
      </Card>
    </div>
  );
}

function Analytics() {
  const { data } = useFetch<{ byEvent: { event: string; n: number }[]; daily: { day: string; n: number }[]; modes: { mode: string; n: number }[]; domains: { domain: string; n: number; correct: number }[]; retention: { week: number; prev_week: number } }>('/admin/analytics');
  if (!data) return <PageSkeleton />;
  const maxD = Math.max(1, ...data.daily.map((d) => d.n));
  return (
    <div className="space-y-6">
      <Card className="p-5"><h2 className="font-bold">Events per day (30 days)</h2><div className="mt-3 flex h-32 items-end gap-1" role="img" aria-label="Events per day">{data.daily.map((d) => <div key={d.day} className="bg-brand flex-1 rounded-t" style={{ height: `${(d.n / maxD) * 100}%` }} title={`${d.day}: ${d.n}`} />)}</div></Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5"><h2 className="font-bold">Feature usage</h2><ul className="mt-2 space-y-1 text-sm">{data.byEvent.map((e) => <li key={e.event} className="flex justify-between"><span>{e.event.replaceAll('_', ' ')}</span><strong>{e.n}</strong></li>)}</ul></Card>
        <Card className="p-5"><h2 className="font-bold">Practice modes</h2><ul className="mt-2 space-y-1 text-sm">{data.modes.map((m) => <li key={m.mode} className="flex justify-between"><span>{m.mode}</span><strong>{m.n}</strong></li>)}</ul></Card>
        <Card className="p-5"><h2 className="font-bold">Topic popularity & accuracy</h2><ul className="mt-2 space-y-1 text-sm">{data.domains.map((d) => <li key={d.domain} className="flex justify-between"><span>{d.domain}</span><span><strong>{d.n}</strong> · {d.n ? Math.round((d.correct / d.n) * 100) : 0}%</span></li>)}</ul></Card>
      </div>
      <Card className="p-5 text-sm">Active learners this week: <strong>{data.retention.week}</strong> (previous week: {data.retention.prev_week}). Analytics contain no personal data or learner content.</Card>
    </div>
  );
}

function Audit() {
  const { data } = useFetch<{ logs: { id: number; action: string; target: string | null; details: string | null; created_at: string; actor: string | null }[] }>('/admin/audit');
  return <Card className="overflow-x-auto p-4"><table className="w-full min-w-[600px] text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="p-2">When</th><th className="p-2">Actor</th><th className="p-2">Action</th><th className="p-2">Target</th></tr></thead><tbody>{data?.logs.map((l) => <tr key={l.id} className="border-t border-border"><td className="p-2 text-muted">{l.created_at}</td><td className="p-2">{l.actor ?? '—'}</td><td className="p-2 font-semibold">{l.action}</td><td className="p-2 text-xs text-muted">{l.target}</td></tr>)}</tbody></table></Card>;
}
