// Test helpers: boot an isolated server and talk to it like a browser (cookie jar + CSRF header).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface TestServer { url: string; dbPath: string; proc: ChildProcess; stop: () => void; answerOf: (questionId: string) => string }

export async function startServer(extraEnv: Record<string, string> = {}): Promise<TestServer> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mathly-test-'));
  const dbPath = path.join(dir, 'test.db');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads'), ADMIN_EMAILS: 'admin@test.dev', AUTH_RATE_LIMIT: '1000', GUEST_RATE_LIMIT: '1000', ANTHROPIC_API_KEY: '', AI_PROVIDER: 'none', NODE_ENV: 'production', PUBLIC_URL: `http://localhost:${port}`, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout!.on('data', (d) => { log += d; }); proc.stderr!.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${url}/api/health`); if (r.ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(`Server failed to start:\n${log}`);
  }
  let db: DatabaseSync | null = null;
  return {
    url, dbPath, proc, stop: () => { db?.close(); proc.kill(); },
    answerOf: (qid: string) => {
      db ??= new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare('SELECT payload FROM issued_questions WHERE id = ?').get(qid) as { payload: string } | undefined;
      if (row) return JSON.parse(row.payload).answer as string;
      // Tutor quizzes live in the conversation context.
      for (const c of db.prepare('SELECT context FROM ai_conversations').all() as { context: string }[]) {
        const q = JSON.parse(c.context ?? '{}').pendingQuiz;
        if (q?.id === qid) return q.answer as string;
      }
      for (const t of db.prepare('SELECT questions FROM test_attempts').all() as { questions: string }[]) {
        const q = (JSON.parse(t.questions) as { id: string; answer: string }[]).find((x) => x.id === qid);
        if (q) return q.answer;
      }
      throw new Error(`No issued question ${qid}`);
    },
  };
}

export class Client {
  cookie = ''; profileId: string | null = null; base: string;
  constructor(base: string) { this.base = base; }
  async req<T = Record<string, unknown>>(method: string, p: string, body?: unknown, opts: { csrf?: boolean; expect?: number } = {}): Promise<T & { _status: number }> {
    const headers: Record<string, string> = {};
    if (opts.csrf !== false) headers['x-mathly'] = '1';
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.cookie = this.cookie;
    if (this.profileId) headers['x-profile-id'] = this.profileId;
    const r = await fetch(`${this.base}/api${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) { const kv = c.split(';')[0]; if (kv.startsWith('mathly_session=')) this.cookie = kv.endsWith('=') ? '' : kv; }
    const data = (r.headers.get('content-type') ?? '').includes('json') ? await r.json() : {};
    if (opts.expect !== undefined && r.status !== opts.expect) throw new Error(`${method} ${p} → ${r.status} (expected ${opts.expect}): ${JSON.stringify(data)}`);
    if (opts.expect === undefined && !r.ok) throw new Error(`${method} ${p} → ${r.status}: ${JSON.stringify(data)}`);
    return { ...(data as T), _status: r.status };
  }
  get<T = Record<string, unknown>>(p: string, expect?: number) { return this.req<T>('GET', p, undefined, { expect }); }
  post<T = Record<string, unknown>>(p: string, body: unknown = {}, expect?: number) { return this.req<T>('POST', p, body, { expect }); }
  patch<T = Record<string, unknown>>(p: string, body: unknown = {}, expect?: number) { return this.req<T>('PATCH', p, body, { expect }); }
  put<T = Record<string, unknown>>(p: string, body: unknown = {}, expect?: number) { return this.req<T>('PUT', p, body, { expect }); }
  del<T = Record<string, unknown>>(p: string, body?: unknown, expect?: number) { return this.req<T>('DELETE', p, body, { expect }); }
}
