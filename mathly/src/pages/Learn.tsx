import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wand2 } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { Badge, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, Progress, Tabs, Button } from '../components/ui.tsx';

export interface CourseCard { id: string; title: string; description: string; band?: string; icon: string; difficulty: string; targetLevel: number; generatedBy: string; status?: string; lessons: number; completed: number; percent: number; enrolled: boolean }

export default function Learn() {
  const { data, error, loading, reload } = useFetch<{ core: CourseCard[]; mine: CourseCard[]; community: CourseCard[] }>('/me/courses');
  const [tab, setTab] = useState<'all' | 'mine' | 'community'>('all');
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load courses.'} onRetry={reload} />;
  const bands = [...new Set(data.core.map((c) => c.band ?? 'Other'))];
  const enrolled = data.core.filter((c) => c.enrolled).concat(data.mine.filter((c) => c.enrolled));
  return (
    <div>
      <PageHeader title="Learn" subtitle="Courses from Kindergarten to university — or build your own." actions={<Link to="/learn-anything"><Button icon={<Wand2 className="h-4 w-4" />}>Learn Anything</Button></Link>} />
      {enrolled.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Your courses</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{enrolled.map((c) => <CourseTile key={c.id} c={c} />)}</div>
        </section>
      )}
      <Tabs tabs={[{ id: 'all', label: 'Curriculum' }, { id: 'mine', label: `My custom courses (${data.mine.length})` }, { id: 'community', label: `Community (${data.community.length})` }]} value={tab} onChange={setTab} />
      <div className="mt-6">
        {tab === 'all' && bands.map((b) => (
          <section key={b} className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">{b}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.core.filter((c) => (c.band ?? 'Other') === b).map((c) => <CourseTile key={c.id} c={c} />)}</div>
          </section>
        ))}
        {tab === 'mine' && (data.mine.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.mine.map((c) => <CourseTile key={c.id} c={c} />)}</div> : <EmptyState icon="✨" title="No custom courses yet" body="Tell us anything you want to learn — calculus, mortgages, rocket science — and we’ll build a personalized path." action={<Link to="/learn-anything"><Button icon={<Plus className="h-4 w-4" />}>Build my course</Button></Link>} />)}
        {tab === 'community' && (data.community.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.community.map((c) => <CourseTile key={c.id} c={c} />)}</div> : <EmptyState icon="🌍" title="No community courses yet" body="Custom courses reviewed and approved by our team will appear here for everyone." />)}
      </div>
    </div>
  );
}

export function CourseTile({ c }: { c: CourseCard }) {
  return (
    <Link to={`/learn/${c.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <span className="bg-brand grid h-12 w-12 place-items-center rounded-2xl text-xl font-bold text-white">{c.icon}</span>
        <div className="flex flex-wrap justify-end gap-1">{c.generatedBy === 'ai' && <Badge tone="warn">AI-built</Badge>}{c.generatedBy === 'planner' && <Badge tone="accent">Personal path</Badge>}{c.enrolled && <Badge tone="success">Enrolled</Badge>}</div>
      </div>
      <h3 className="mt-4 font-bold leading-snug">{c.title}</h3>
      <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{c.description}</p>
      <div className="mt-4 flex items-center gap-3"><Progress value={c.percent} label={`${c.title} progress`} /><span className="shrink-0 text-xs font-bold text-muted">{c.completed}/{c.lessons}</span></div>
    </Link>
  );
}
