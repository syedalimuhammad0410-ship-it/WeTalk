import { useState } from 'react';
import { ExternalLink, Library } from 'lucide-react';
import { DOMAINS } from '../../shared/curriculum.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import type { DomainId } from '../../shared/types.ts';
import { useFetch } from '../lib/store.tsx';
import { Badge, Card, PageHeader, PageSkeleton, cx } from '../components/ui.tsx';

interface R { id: string; title: string; url: string; source: string; kind: string; skill_ids: string[]; domain: DomainId | null; difficulty: string | null; description: string | null }

export default function Resources() {
  const { data, loading } = useFetch<{ resources: R[] }>('/me/resources');
  const [dom, setDom] = useState<string>('all');
  if (loading && !data) return <PageSkeleton />;
  const list = (data?.resources ?? []).filter((r) => dom === 'all' || r.domain === dom);
  const doms = [...new Set((data?.resources ?? []).map((r) => r.domain).filter(Boolean))] as DomainId[];
  return (
    <div>
      <PageHeader icon={<Library className="h-7 w-7 text-accent" />} title="Resources" subtitle="Hand-picked videos, articles, courses and tools from trusted external sources." />
      <Card className="mb-5 p-4 text-sm text-muted"><Badge tone="warn">External</Badge> These links open on other websites that Mathly doesn’t control. Mathly’s own lessons and AI explanations are always labeled separately.</Card>
      <div className="scrollbar-thin mb-5 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => setDom('all')} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', dom === 'all' ? 'bg-brand text-white' : 'bg-surface-2 text-muted')}>All</button>
        {doms.map((d) => <button key={d} onClick={() => setDom(d)} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', dom === d ? 'bg-brand text-white' : 'bg-surface-2 text-muted')}>{DOMAINS[d].icon} {DOMAINS[d].name}</button>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((r) => (
          <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="card group flex flex-col p-5 transition hover:-translate-y-0.5">
            <div className="flex items-center gap-2"><Badge tone="accent">{r.kind}</Badge>{r.difficulty && <Badge>{r.difficulty}</Badge>}<ExternalLink className="ml-auto h-4 w-4 text-muted" aria-label="Opens external site" /></div>
            <h3 className="mt-3 font-bold group-hover:text-accent">{r.title}</h3>
            <p className="mt-1 text-sm text-muted">External · {r.source}</p>
            {r.skill_ids.length > 0 && <p className="mt-3 text-xs text-muted">Covers: {r.skill_ids.slice(0, 4).map((s) => SKILL_MAP[s]?.title).filter(Boolean).join(', ')}{r.skill_ids.length > 4 ? '…' : ''}</p>}
          </a>
        ))}
      </div>
    </div>
  );
}
