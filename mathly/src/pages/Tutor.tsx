import { useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/store.tsx';
import { TutorChat } from '../components/TutorChat.tsx';
import { Card } from '../components/ui.tsx';

export default function Tutor() {
  const { aiConfigured } = useApp();
  const [params] = useSearchParams();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card className="flex h-[calc(100dvh-11rem)] min-h-[520px] flex-col overflow-hidden lg:h-[calc(100dvh-8rem)]">
        <TutorChat className="h-full" autoPrompt={params.get('q') ?? undefined} context={params.get('skill') ? { skillId: params.get('skill')! } : undefined} />
      </Card>
      <aside className="space-y-4">
        <Card className="p-5">
          <h2 className="font-bold">What I can do</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            <li>💡 Give hints without spoiling the answer</li><li>🧠 Re-explain at your level — “like I’m 10” or university-level</li><li>✏️ Show worked examples</li><li>❓ Quiz you and check your answers</li><li>🔎 Find where your reasoning changed</li><li>🎙️ Talk hands-free (where supported)</li>
          </ul>
        </Card>
        <Card className="p-5 text-sm text-muted">
          <h2 className="mb-1 font-bold text-text">How I teach</h2>
          I use <strong className="text-text">Understand → Plan → Solve → Check → Communicate</strong>. I’ll ask questions to help you think, and every number I give is checked by Mathly’s math engine.
          {!aiConfigured && <p className="mt-3 rounded-xl bg-surface-2 p-3">Running on the built-in tutor. An administrator can connect the AI tutor for open-ended conversation.</p>}
        </Card>
        <Card className="p-5 text-xs text-muted">Your tutor chats are private to your profile and are not shown on parent or teacher reports. You can turn off chat history in Settings.</Card>
      </aside>
    </div>
  );
}
