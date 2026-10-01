import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { CheckCircle2, Lock, Sparkles, Circle, PlayCircle, RotateCcw } from 'lucide-react';
import type { DomainId } from '../../shared/types.ts';
import { useFetch, useApp } from '../lib/store.tsx';
import { levelLabel } from '../../shared/curriculum.ts';
import { Badge, Button, Card, ErrorState, Modal, PageHeader, PageSkeleton, Ring, Tabs, cx } from '../components/ui.tsx';

interface Node { id: string; title: string; domain: DomainId; grade: number; gradeLabel: string; prereqs: string[]; summary: string; mastery: number; attempts: number; estimated: boolean; reviewDue: boolean; status: 'completed' | 'in_progress' | 'recommended' | 'available' | 'locked' }
interface Data { nodes: Node[]; domains: { id: DomainId; name: string; icon: string; color: string }[]; domainLevels: Partial<Record<DomainId, number>> }

const STATUS = {
  completed: { label: 'Completed', icon: CheckCircle2, cls: 'border-success bg-success-soft text-success' },
  in_progress: { label: 'In progress', icon: PlayCircle, cls: 'border-accent/60 bg-accent-soft text-accent' },
  recommended: { label: 'Recommended', icon: Sparkles, cls: 'border-warn bg-warn-soft text-warn' },
  available: { label: 'Available', icon: Circle, cls: 'border-border bg-surface text-text' },
  locked: { label: 'Needs prerequisites', icon: Lock, cls: 'border-border bg-surface-2 text-muted' },
} as const;

export default function SkillTree() {
  const { data, error, loading, reload } = useFetch<Data>('/me/skills');
  const { profile } = useApp();
  const [domain, setDomain] = useState<string>('all');
  const [view, setView] = useState<'tree' | 'map'>('tree');
  const [sel, setSel] = useState<Node | null>(null);
  const byId = useMemo(() => Object.fromEntries((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the skill tree.'} onRetry={reload} />;
  const domains = data.domains.filter((d) => data.nodes.some((n) => n.domain === d.id));
  const shown = domain === 'all' ? domains : domains.filter((d) => d.id === domain);
  const counts = data.nodes.reduce<Record<string, number>>((a, n) => ((a[n.status] = (a[n.status] ?? 0) + 1), a), {});

  return (
    <div>
      <PageHeader title="Skill Tree" subtitle="Every node is a skill. Master prerequisites to unlock what comes next." actions={<Tabs tabs={[{ id: 'tree', label: 'Tree' }, { id: 'map', label: 'Graph' }]} value={view} onChange={setView} />} />
      <div className="mb-5 flex flex-wrap gap-2">{(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((s) => { const I = STATUS[s].icon; return <span key={s} className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', STATUS[s].cls)}><I className="h-3.5 w-3.5" />{STATUS[s].label} · {counts[s] ?? 0}</span>; })}</div>
      <div className="scrollbar-thin mb-6 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setDomain('all')} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', domain === 'all' ? 'bg-brand text-white' : 'bg-surface-2 text-muted')}>All areas</button>
        {domains.map((d) => <button key={d.id} onClick={() => setDomain(d.id)} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', domain === d.id ? 'bg-brand text-white' : 'bg-surface-2 text-muted')}>{d.icon} {d.name}</button>)}
      </div>
      {view === 'map' ? <GraphView nodes={data.nodes.filter((n) => domain === 'all' || n.domain === domain)} byId={byId} onSelect={setSel} /> : (
        <div className="space-y-6">
          {shown.map((d) => {
            const nodes = data.nodes.filter((n) => n.domain === d.id).sort((a, b) => a.grade - b.grade);
            const grades = [...new Set(nodes.map((n) => n.grade))];
            const avg = Math.round(nodes.reduce((s, n) => s + n.mastery, 0) / nodes.length);
            return (
              <Card key={d.id} className="p-5">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl text-xl" style={{ background: `${d.color}22` }}>{d.icon}</span>
                  <div className="mr-auto"><h2 className="text-lg font-bold">{d.name}</h2><p className="text-sm text-muted">{data.domainLevels[d.id] != null ? `Working at ${levelLabel(data.domainLevels[d.id], 'us')}` : 'Not assessed yet'}</p></div>
                  <Ring value={avg} size={52} stroke={6} color={d.color}><span className="text-xs font-bold">{avg}%</span></Ring>
                </div>
                <div className="relative space-y-3 border-l-2 border-dashed border-border pl-5">
                  {grades.map((g) => (
                    <div key={g}>
                      <p className="-ml-[1.72rem] mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted"><span className="h-3 w-3 rounded-full border-2 border-border bg-bg" />{nodes.find((n) => n.grade === g)?.gradeLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        {nodes.filter((n) => n.grade === g).map((n) => <SkillChip key={n.id} n={n} onClick={() => setSel(n)} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.title}>
        {sel && (
          <div>
            <div className="flex flex-wrap gap-1.5"><Badge>{sel.gradeLabel}</Badge><Badge tone={sel.status === 'completed' ? 'success' : sel.status === 'locked' ? 'neutral' : 'accent'}>{STATUS[sel.status].label}</Badge>{sel.reviewDue && <Badge tone="warn"><RotateCcw className="h-3 w-3" />Review due</Badge>}{sel.estimated && <Badge>Estimated from placement</Badge>}</div>
            <p className="mt-3 text-muted">{sel.summary}</p>
            <div className="mt-4 flex items-center gap-4"><Ring value={sel.mastery} size={72} stroke={7}><span className="text-sm font-bold">{sel.mastery}%</span></Ring><div className="text-sm"><p><strong>Mastery</strong> — based on accuracy, difficulty, recency and explanations.</p><p className="text-muted">{sel.attempts} questions answered</p></div></div>
            {sel.prereqs.length > 0 && <div className="mt-4"><p className="text-sm font-bold">Prerequisites</p><ul className="mt-1 space-y-1">{sel.prereqs.map((p) => <li key={p} className="flex items-center justify-between text-sm"><button className="font-semibold text-accent" onClick={() => setSel(byId[p])}>{byId[p]?.title}</button><span className="text-muted">{byId[p]?.mastery ?? 0}%</span></li>)}</ul></div>}
            {(() => { const unlocks = data.nodes.filter((n) => n.prereqs.includes(sel.id)); return unlocks.length ? <div className="mt-4"><p className="text-sm font-bold">Unlocks</p><div className="mt-1 flex flex-wrap gap-1.5">{unlocks.map((u) => <button key={u.id} onClick={() => setSel(u)}><Badge tone="accent">{u.title}</Badge></button>)}</div></div> : null; })()}
            <div className="mt-6 flex flex-wrap gap-2"><Link to={`/lesson/${sel.id}`}><Button>Open lesson</Button></Link><Link to={`/practice/session?skill=${sel.id}&mode=practice`}><Button variant="secondary">Practice</Button></Link></div>
            {sel.status === 'locked' && <p className="mt-3 text-xs text-muted">Locked skills are a recommendation, not a wall — {profile?.name ?? 'you'} can still open them anytime.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function SkillChip({ n, onClick }: { n: Node; onClick: () => void }) {
  const s = STATUS[n.status]; const I = s.icon;
  return (
    <motion.button whileHover={{ y: -2 }} onClick={onClick} className={cx('flex items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-sm font-semibold transition', s.cls)} aria-label={`${n.title}: ${s.label}, ${n.mastery}% mastery`}>
      <I className="h-4 w-4 shrink-0" />
      <span>{n.title}</span>
      {n.mastery > 0 && <span className="rounded-lg bg-surface/70 px-1.5 text-xs">{n.mastery}%</span>}
      {n.reviewDue && <RotateCcw className="h-3.5 w-3.5 text-warn" aria-label="Review due" />}
    </motion.button>
  );
}

/** Interactive graph: skills laid out by grade (x) and domain (y), edges for prerequisites. */
function GraphView({ nodes, byId, onSelect }: { nodes: Node[]; byId: Record<string, Node>; onSelect: (n: Node) => void }) {
  const domains = [...new Set(nodes.map((n) => n.domain))];
  const grades = [...new Set(nodes.map((n) => n.grade))].sort((a, b) => a - b);
  const pos: Record<string, { x: number; y: number }> = {};
  const colW = 150, rowH = 64;
  let y = 30;
  for (const d of domains) {
    const dn = nodes.filter((n) => n.domain === d);
    const maxStack = Math.max(...grades.map((g) => dn.filter((n) => n.grade === g).length), 1);
    for (const g of grades) dn.filter((n) => n.grade === g).forEach((n, i) => { pos[n.id] = { x: 40 + grades.indexOf(g) * colW, y: y + i * rowH }; });
    y += maxStack * rowH + 30;
  }
  const W = 80 + grades.length * colW, H = y;
  const color = (s: Node['status']) => (s === 'completed' ? 'var(--success)' : s === 'recommended' ? 'var(--warn)' : s === 'in_progress' ? 'var(--accent)' : s === 'locked' ? 'var(--border)' : 'var(--muted)');
  return (
    <Card className="overflow-auto p-2">
      <svg width={W} height={H} role="img" aria-label="Skill graph">
        {nodes.flatMap((n) => n.prereqs.filter((p) => pos[p] && pos[n.id]).map((p) => <path key={`${p}-${n.id}`} d={`M${pos[p].x + 120},${pos[p].y + 18} C${pos[p].x + 140},${pos[p].y + 18} ${pos[n.id].x - 20},${pos[n.id].y + 18} ${pos[n.id].x},${pos[n.id].y + 18}`} fill="none" stroke={byId[p]?.status === 'completed' ? 'var(--success)' : 'var(--border)'} strokeWidth={1.5} />))}
        {nodes.map((n) => pos[n.id] && (
          <g key={n.id} transform={`translate(${pos[n.id].x},${pos[n.id].y})`} onClick={() => onSelect(n)} className="cursor-pointer" role="button" tabIndex={0} aria-label={`${n.title} ${n.mastery}%`} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(n); }}>
            <rect width={120} height={36} rx={12} fill="var(--surface)" stroke={color(n.status)} strokeWidth={2} />
            <rect width={(120 * n.mastery) / 100} height={4} y={32} rx={2} fill={color(n.status)} />
            <text x={60} y={22} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">{n.title.length > 18 ? `${n.title.slice(0, 17)}…` : n.title}</text>
          </g>
        ))}
      </svg>
    </Card>
  );
}
