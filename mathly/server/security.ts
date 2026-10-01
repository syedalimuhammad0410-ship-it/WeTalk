// HTTP security helpers: errors, validation, rate limiting, headers, CSRF guard.
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') { super(message); this.status = status; this.code = code; }
}
export const bad = (msg: string) => new HttpError(400, msg, 'bad_request');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg, 'forbidden');

// ─────────────────────────── input validation (small, explicit, no magic)
export function str(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw bad(`${name} is required`);
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const s = v.trim();
  if (opts.min && s.length < opts.min) throw bad(`${name} must be at least ${opts.min} characters`);
  if (s.length > (opts.max ?? 500)) throw bad(`${name} is too long`);
  return s;
}
export function num(v: unknown, name: string, opts: { min?: number; max?: number; optional?: boolean; int?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === '') { if (opts.optional) return null; throw bad(`${name} is required`); }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  if (opts.int && !Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  if (opts.min !== undefined && n < opts.min) throw bad(`${name} is too small`);
  if (opts.max !== undefined && n > opts.max) throw bad(`${name} is too large`);
  return n;
}
export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw bad(`${name} is not valid`);
  return v as T;
}
export function strArray(v: unknown, name: string, opts: { maxItems?: number; maxLen?: number } = {}): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad(`${name} must be a list`);
  if (v.length > (opts.maxItems ?? 50)) throw bad(`${name} has too many items`);
  return v.map((x, i) => str(x, `${name}[${i}]`, { max: opts.maxLen ?? 120 }));
}
export const isEmail = (s: string) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(s);

// ─────────────────────────── rate limiting (in-memory sliding window; swap for Redis when scaling out)
const buckets = new Map<string, number[]>();
export function rateLimit(name: string, max: number, windowMs: number, keyFn?: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${name}:${keyFn ? keyFn(req) : req.ip}`;
    const now = Date.now();
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) return next(new HttpError(429, 'You’re going a little fast. Please wait a moment and try again.', 'rate_limited'));
    hits.push(now); buckets.set(key, hits);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3_600_000)) buckets.delete(k); }, 600_000).unref();

// ─────────────────────────── headers & CSRF
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self' https://appleid.apple.com",
    ].join('; '));
  }
  next();
}

/** Mutating API calls must carry a custom header, which browsers will not send cross-site without CORS. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/auth/oauth/') && req.path.endsWith('/callback')) return next(); // Apple form_post
  if (req.get('x-mathly') !== '1') return next(new HttpError(403, 'Missing request header.', 'csrf'));
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const e = err as HttpError & { type?: string };
  if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large. Please use an image under 8 MB.', code: 'too_large' });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.', code: 'bad_json' });
  const status = e instanceof HttpError ? e.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.path}`, err);
  // Never leak stack traces or internals to users.
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side. Please try again.' : e.message, code: e instanceof HttpError ? e.code : 'server_error' });
}
