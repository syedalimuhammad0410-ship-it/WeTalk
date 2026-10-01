import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { post, errMsg } from '../lib/api.ts';
import { Logo } from '../components/Logo.tsx';
import { Button, Card, Input, Modal } from '../components/ui.tsx';

const PROVIDERS = [
  { id: 'google', label: 'Continue with Google', icon: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg> },
  { id: 'apple', label: 'Continue with Apple', icon: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="currentColor"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.9-.9-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.1 5.8c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z" /></svg> },
  { id: 'microsoft', label: 'Continue with Microsoft', icon: <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#F25022" d="M3 3h8.5v8.5H3z" /><path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5z" /><path fill="#00A4EF" d="M3 12.5h8.5V21H3z" /><path fill="#FFB900" d="M12.5 12.5H21V21h-8.5z" /></svg> },
] as const;

export default function Auth() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>(params.get('mode') === 'login' ? 'login' : 'register');
  const { setUser, refreshUser, providers, user } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [setupFor, setSetupFor] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await post<{ user: { id: string; email: string; displayName: string; role: string; isGuest: boolean } }>(`/auth/${mode}`, mode === 'register' ? { email, password, displayName: name } : { email, password });
      setUser(r.user); await refreshUser(); nav('/profiles');
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between"><Link to="/welcome" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-text"><ArrowLeft className="h-4 w-4" />Back</Link><Logo size={30} /></div>
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold">{mode === 'register' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'register' ? (user?.isGuest ? 'Your guest progress will be kept and saved to your account.' : 'Save your progress across devices, keep your XP and achievements, and back up every profile.') : 'Sign in to continue learning.'}</p>
          <div className="mt-6 space-y-2.5">
            {PROVIDERS.map((p) => (
              <Button key={p.id} variant="secondary" className="w-full" icon={p.icon} onClick={() => { if (providers[p.id]) window.location.href = `/api/auth/oauth/${p.id}/start`; else setSetupFor(p.label.replace('Continue with ', '')); }}>{p.label}</Button>
            ))}
          </div>
          <div className="my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted"><span className="h-px flex-1 bg-border" />or with email<span className="h-px flex-1 bg-border" /></div>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && <Input label="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />}
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 8 : 1} hint={mode === 'register' ? 'At least 8 characters, including a letter and a number.' : undefined} />
            {error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>{mode === 'register' ? 'Create account' : 'Sign in'}</Button>
          </form>
          <p className="mt-5 text-center text-sm text-muted">
            {mode === 'register' ? <>Already have an account? <button className="font-semibold text-accent" onClick={() => setMode('login')}>Sign in</button></> : <>New to Mathly? <button className="font-semibold text-accent" onClick={() => setMode('register')}>Create an account</button></>}
          </p>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">We only store what we need to run Mathly. We never sell educational data.</p>
      </div>
      <Modal open={!!setupFor} onClose={() => setSetupFor(null)} title={`${setupFor} sign-in isn’t set up yet`}>
        <p className="text-sm text-muted">This server hasn’t been configured with {setupFor} credentials. You can still create an account with email, or continue as a guest.</p>
        <p className="mt-3 text-sm">Administrators: see the <Link to="/setup" className="font-semibold text-accent">setup page</Link> for the environment variables to add.</p>
        <div className="mt-5 flex justify-end"><Button onClick={() => setSetupFor(null)}>Use email instead</Button></div>
      </Modal>
    </div>
  );
}
