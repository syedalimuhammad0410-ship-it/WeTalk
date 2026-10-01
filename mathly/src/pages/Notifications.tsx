import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useFetch } from '../lib/store.tsx';
import { post } from '../lib/api.ts';
import { Button, Card, EmptyState, PageHeader, PageSkeleton, cx } from '../components/ui.tsx';

interface N { id: string; kind: string; title: string; body: string | null; link: string | null; read: number; created_at: string }
const ICON: Record<string, string> = { daily_goal: '🎯', test: '📝', review: '🔁', achievement: '🏆', homework: '📒', course: '✨' };

export default function Notifications() {
  const { data, loading, reload } = useFetch<{ notifications: N[] }>('/me/notifications');
  if (loading && !data) return <PageSkeleton />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader icon={<Bell className="h-7 w-7 text-accent" />} title="Notifications" actions={<Button variant="secondary" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={async () => { await post('/me/notifications/read'); reload(); }}>Mark all read</Button>} />
      {!data?.notifications.length ? <EmptyState icon="🔔" title="You’re all caught up" body="Reminders about goals, tests and reviews will appear here. Manage them in Settings." /> : (
        <div className="space-y-2">{data.notifications.map((n) => (
          <Link key={n.id} to={n.link ?? '#'} onClick={() => post('/me/notifications/read', { id: n.id }).catch(() => {})}>
            <Card className={cx('mb-2 flex items-start gap-3 p-4 transition hover:-translate-y-0.5', !n.read && 'border-accent/40 bg-accent-soft')}>
              <span className="text-2xl">{ICON[n.kind] ?? '🔔'}</span>
              <span className="min-w-0 flex-1"><span className="block font-bold">{n.title}</span>{n.body && <span className="block text-sm text-muted">{n.body}</span>}<span className="text-xs text-muted">{new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</span></span>
              {!n.read && <span className="mt-2 h-2.5 w-2.5 rounded-full bg-accent" aria-label="Unread" />}
            </Card>
          </Link>
        ))}</div>
      )}
    </div>
  );
}
