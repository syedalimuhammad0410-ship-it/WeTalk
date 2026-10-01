// Netlify deployment: runs the Mathly Express API inside a function.
// Function instances are ephemeral and may run in parallel, so the SQLite file is snapshotted to
// Netlify Blobs after every change and re-downloaded when another instance has saved a newer copy.
import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

let base: string | null = null;
let dbModule: typeof import('../../server/db.ts') | null = null;
let localEtag: string | null = null;
let lastSig = '';
const hash = (b: Buffer) => { let h = 2166136261; for (let i = 0; i < b.length; i += 7) { h ^= b[i]; h = Math.imul(h, 16777619); } return `${b.length}:${h >>> 0}`; };

async function boot() {
  process.env.DATABASE_PATH ??= '/tmp/mathly.db';
  process.env.UPLOAD_DIR ??= '/tmp/uploads';
  process.env.NODE_ENV ??= 'production';
  process.env.SQLITE_JOURNAL = 'DELETE';
  dbModule = await import('../../server/db.ts');
  const { app } = await import('../../server/app.ts');
  // Run Express on a loopback port inside the instance and forward requests to it.
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export default async (req: Request, _context: Context) => {
  const DB = process.env.DATABASE_PATH ?? '/tmp/mathly.db';
  const store = getStore({ name: 'mathly-db', consistency: 'strong' });
  const meta = await store.getMetadata('sqlite');
  if (meta?.etag && meta.etag !== localEtag) {
    const data = await store.get('sqlite', { type: 'arrayBuffer' });
    if (data) { const buf = Buffer.from(data); writeFileSync(DB, buf); lastSig = hash(buf); }
    localEtag = meta.etag;
    dbModule?.reopenDb();
  }
  if (!base) await boot();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api');
  const headers = new Headers(req.headers);
  headers.set('x-forwarded-proto', 'https');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
  const res = await fetch(`${base}${path}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });

  if (existsSync(DB)) {
    const bytes = readFileSync(DB);
    const sig = hash(bytes);
    if (sig !== lastSig) {
      await store.set('sqlite', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer);
      localEtag = (await store.getMetadata('sqlite'))?.etag ?? localEtag;
      lastSig = sig;
    }
  }
  const out = new Headers();
  res.headers.forEach((v, k) => { if (k !== 'set-cookie' && k !== 'content-encoding' && k !== 'content-length' && k !== 'transfer-encoding') out.set(k, v); });
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.status === 204 || res.status === 304 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
};
