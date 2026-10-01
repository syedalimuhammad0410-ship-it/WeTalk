import type { PublicQuestion } from '../../shared/types.ts';
import { useFetch } from '../lib/store.tsx';
import { QuestionCard, StepLine } from '../components/QuestionCard.tsx';
import { Card, ErrorState, PageHeader, PageSkeleton } from '../components/ui.tsx';

interface Daily { day: string; solved: boolean; question: PublicQuestion; solution: { answer: string; steps: string[]; explanation: string } | null; tagline?: string }

export default function DailyPage() {
  const { data, error, loading, reload } = useFetch<Daily>('/me/daily');
  if (loading && !data) return <PageSkeleton />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load today’s challenge.'} onRetry={reload} />;
  const date = new Date(`${data.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={<span className="text-3xl">🌅</span>} title="Daily Challenge" subtitle={`${date} · Can you solve this without a calculator? +100 XP`} />
      {data.solved && data.solution ? (
        <Card className="p-6">
          <p className="text-lg font-bold">✅ Solved! Come back tomorrow for a new challenge.</p>
          <p className="mt-4 font-semibold">{data.question.prompt}</p>
          <ol className="mt-3 space-y-1.5 text-sm">{data.solution.steps.map((s, i) => <li key={i}><StepLine s={s} /></li>)}</ol>
          <p className="mt-3 text-sm text-muted">{data.solution.explanation}</p>
        </Card>
      ) : (
        <QuestionCard question={data.question} mode="daily" onNext={reload} nextLabel="See result" />
      )}
      <p className="mt-6 text-center text-sm text-muted">Difficulty adapts to your recent daily challenge results.</p>
    </div>
  );
}
