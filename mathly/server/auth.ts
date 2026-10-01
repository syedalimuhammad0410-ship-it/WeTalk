// Authentication: guest devices, email/password, sessions, roles, profile scoping.
import { randomBytes, randomUUID, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { config, oauthConfigured } from './config.ts';
import { all, audit, one, run, tx } from './db.ts';
import { HttpError, bad, forbidden, isEmail, rateLimit, str } from './security.ts';
import { track } from './analytics.ts';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const ROLES = ['user', 'parent', 'teacher', 'moderator', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];
const RANK: Record<Role, number> = { user: 0, parent: 1, teacher: 1, moderator: 2, admin: 3, super_admin: 4 };

export interface SessionUser { id: string; email: string | null; display_name: string | null; role: Role; is_guest: number }
export interface ProfileRow {
  id: string; user_id: string; name: string; avatar: string; color: string; school_grade: number | null; curriculum: string; current_course: string | null;
  purposes: string; enjoys: string; styles: string; goals: string; learning_level: number | null; onboarded: number; placement_done: number;
  daily_goal_min: number; preferences: string; pin_hash: string | null; created_at: string; updated_at: string;
}
declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser; profile?: ProfileRow }
}

// ─────────────────────────── passwords & sessions
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const hash = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const COOKIE = 'mathly_session';

export function createSession(res: Response, userId: string, guest = false) {
  const token = randomBytes(32).toString('base64url');
  const days = guest ? config.guestSessionDays : config.sessionDays;
  const expires = new Date(Date.now() + days * 86_400_000);
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, expires.toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, expires, path: '/' });
}
function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const u = one<SessionUser & { expires_at: string; disabled: number }>(
      `SELECT u.id, u.email, u.display_name, u.role, u.is_guest, u.disabled, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
    if (u && new Date(u.expires_at) > new Date() && !u.disabled) req.user = { id: u.id, email: u.email, display_name: u.display_name, role: u.role, is_guest: u.is_guest };
  }
  next();
}
export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in or continue as a guest.', 'unauthenticated'));
  next();
}
export const hasRole = (u: SessionUser | undefined, role: Role) => !!u && RANK[u.role] >= RANK[role];
export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.', 'unauthenticated'));
    if (!hasRole(req.user, role)) return next(forbidden());
    next();
  };
}
/** Resolve the active learner profile from the X-Profile-Id header and make sure the caller owns it. */
export function requireProfile(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Please sign in or continue as a guest.', 'unauthenticated'));
  const id = req.get('x-profile-id');
  if (!id) return next(new HttpError(400, 'Choose a learner profile first.', 'no_profile'));
  const p = one<ProfileRow>('SELECT * FROM profiles WHERE id = ? AND user_id = ?', id, req.user.id);
  if (!p) return next(new HttpError(404, 'Profile not found.', 'no_profile'));
  req.profile = p;
  next();
}

function roleForEmail(email: string): Role { return config.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user'; }

/** Move all profiles from a guest user into a real account (used when a guest signs in). */
export function mergeGuestInto(guestId: string, userId: string) {
  if (guestId === userId) return;
  const guest = one<{ is_guest: number }>('SELECT is_guest FROM users WHERE id = ?', guestId);
  if (!guest?.is_guest) return;
  tx(() => {
    run('UPDATE profiles SET user_id = ? WHERE user_id = ?', userId, guestId);
    run('DELETE FROM users WHERE id = ?', guestId);
  });
}

export function publicUser(u: SessionUser | undefined) {
  if (!u) return null;
  return { id: u.id, email: u.email, displayName: u.display_name, role: u.role, isGuest: !!u.is_guest };
}

// ─────────────────────────── routes
export const authRouter = Router();
// Brute-force protection for credential endpoints; guest creation has its own, looser limit.
const authLimiter = rateLimit('auth', Number(process.env.AUTH_RATE_LIMIT || 30), 15 * 60_000);
const guestLimiter = rateLimit('guest', Number(process.env.GUEST_RATE_LIMIT || 60), 15 * 60_000);

authRouter.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user), providers: oauthConfigured });
});

authRouter.post('/guest', guestLimiter, (req, res) => {
  if (req.user) return res.json({ user: publicUser(req.user) });
  const id = randomUUID();
  run('INSERT INTO users (id, is_guest, display_name) VALUES (?, 1, ?)', id, 'Guest');
  createSession(res, id, true);
  track('guest_created');
  res.json({ user: { id, email: null, displayName: 'Guest', role: 'user', isGuest: true } });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 200 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { min: 8, max: 200 });
  const displayName = str(req.body?.displayName, 'Name', { optional: true, max: 60 }) || email.split('@')[0];
  if (!isEmail(email)) throw bad('Please enter a valid email address.');
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) throw bad('Use at least 8 characters with a letter and a number.');
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists. Try signing in.', 'exists');
  const hash = await hashPassword(password);
  const role = roleForEmail(email);
  let userId: string;
  if (req.user?.is_guest) {
    // Upgrade the guest in place so every profile, XP and course is preserved.
    userId = req.user.id;
    run('UPDATE users SET email = ?, password_hash = ?, display_name = ?, role = ?, is_guest = 0 WHERE id = ?', email, hash, displayName, role, userId);
    run('DELETE FROM sessions WHERE user_id = ?', userId);
  } else {
    userId = randomUUID();
    run('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)', userId, email, hash, displayName, role);
  }
  createSession(res, userId);
  audit(userId, 'account.register');
  track('account_created', { method: 'email' });
  res.json({ user: { id: userId, email, displayName, role, isGuest: false } });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const email = str(req.body?.email, 'Email', { max: 200 }).toLowerCase();
  const password = str(req.body?.password, 'Password', { max: 200 });
  const u = one<SessionUser & { password_hash: string; disabled: number }>('SELECT id, email, display_name, role, is_guest, password_hash, disabled FROM users WHERE email = ?', email);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new HttpError(401, 'That email and password don’t match. Please try again.', 'invalid_credentials');
  if (u.disabled) throw forbidden('This account has been disabled.');
  if (req.user?.is_guest && req.body?.mergeGuest !== false) mergeGuestInto(req.user.id, u.id);
  destroySession(req, res);
  createSession(res, u.id);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", u.id);
  track('login', { method: 'email' });
  res.json({ user: publicUser(u) });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.post('/change-password', async (req, res) => {
  if (!req.user || req.user.is_guest) throw new HttpError(401, 'Sign in first.', 'unauthenticated');
  const current = str(req.body?.current, 'Current password', { max: 200 });
  const next = str(req.body?.next, 'New password', { min: 8, max: 200 });
  const u = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!(await verifyPassword(current, u?.password_hash ?? null))) throw bad('Your current password is incorrect.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
  audit(req.user.id, 'account.password_changed');
  res.json({ ok: true });
});

/** Permanently delete the account and all learner data (privacy requirement). */
authRouter.delete('/account', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sign in first.', 'unauthenticated');
  const confirm = str(req.body?.confirm, 'Confirmation', { max: 20 });
  if (confirm !== 'DELETE') throw bad('Type DELETE to confirm.');
  const uid = req.user.id;
  tx(() => { run('DELETE FROM users WHERE id = ?', uid); });
  audit(uid, 'account.deleted');
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

export function listUsersWithCounts() {
  return all(`SELECT u.id, u.email, u.display_name, u.role, u.is_guest, u.disabled, u.created_at, u.last_login_at,
    (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles FROM users u ORDER BY u.created_at DESC LIMIT 500`);
}
