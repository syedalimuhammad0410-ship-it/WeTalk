import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { Logo } from '../components/Logo.tsx';
import { Card } from '../components/ui.tsx';

const ITEMS = [
  { key: 'ai', title: 'AI tutor, homework photo reading & AI course builder', env: ['ANTHROPIC_API_KEY', 'AI_MODEL (optional, default claude-opus-5-5)'], note: 'Without it, Mathly uses its built-in tutor, problem solver and curriculum planner. Photo reading requires the AI vision service.' },
  { key: 'google', title: 'Sign in with Google', env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], note: 'Redirect URI: {PUBLIC_URL}/api/auth/oauth/google/callback' },
  { key: 'microsoft', title: 'Sign in with Microsoft', env: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT (optional)'], note: 'Redirect URI: {PUBLIC_URL}/api/auth/oauth/microsoft/callback' },
  { key: 'apple', title: 'Sign in with Apple', env: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'], note: 'Redirect URI: {PUBLIC_URL}/api/auth/oauth/apple/callback (form_post)' },
];

export default function Setup() {
  const { aiConfigured, providers } = useApp();
  const status: Record<string, boolean> = { ai: aiConfigured, ...providers };
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Logo />
      <h1 className="mt-8 text-3xl font-extrabold">Integration setup</h1>
      <p className="mt-2 text-muted">Mathly runs fully without external services. Add these environment variables to the server’s <code className="rounded bg-surface-2 px-1">.env</code> file (see <code className="rounded bg-surface-2 px-1">.env.example</code>) and restart to enable each integration. Secrets stay on the server — they are never sent to the browser.</p>
      <div className="mt-8 space-y-4">
        {ITEMS.map((it) => (
          <Card key={it.key} className="p-5">
            <div className="flex items-start gap-3">
              {status[it.key] ? <CheckCircle2 className="mt-0.5 h-6 w-6 text-success" /> : <CircleDashed className="mt-0.5 h-6 w-6 text-muted" />}
              <div className="min-w-0">
                <h2 className="font-bold">{it.title} <span className={`ml-2 text-sm font-semibold ${status[it.key] ? 'text-success' : 'text-muted'}`}>{status[it.key] ? 'Configured' : 'Not configured'}</span></h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">{it.env.map((e) => <li key={e}><code className="rounded-lg bg-surface-2 px-2 py-1 text-xs">{e}</code></li>)}</ul>
                <p className="mt-2 text-sm text-muted">{it.note}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Link to="/" className="mt-8 inline-block font-semibold text-accent">← Back to Mathly</Link>
    </div>
  );
}
