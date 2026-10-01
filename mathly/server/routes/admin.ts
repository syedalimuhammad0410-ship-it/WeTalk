// Admin dashboard API. Role-based: moderators review content; admins manage users, rules and
// resources; super admins can grant admin roles. Every mutation is written to the audit log.
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { Router } from 'express';
import type { Course } from '../../shared/types.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import { ACHIEVEMENTS, DEFAULT_XP_RULES, XP_RULE_LABELS, DOMAINS } from '../../shared/curriculum.ts';
import { config, oauthConfigured } from '../config.ts';
import { all, audit, getSetting, json, one, run, setSetting } from '../db.ts';
import { ROLES, hasRole, listUsersWithCounts, requireRole, type Role } from '../auth.ts';
import { bad, forbidden, notFound, num, oneOf, str, strArray } from '../security.ts';
import { aiConfigured } from '../ai/provider.ts';

export const adminRouter = Router();
adminRouter.use(requireRole('moderator'));
const started = Date.now();

adminRouter.get('/overview', (req, res) => {
  const c = (sql: string) => one<{ n: number }>(sql)!.n;
  let dbSize = 0; try { dbSize = statSync(config.dbPath).size; } catch { /* ignore */ }
  res.json({
    role: req.user!.role,
    counts: {
      accounts: c('SELECT COUNT(*) n FROM users WHERE is_guest = 0'), guests: c('SELECT COUNT(*) n FROM users WHERE is_guest = 1'), profiles: c('SELECT COUNT(*) n FROM profiles'),
      questions: c('SELECT COUNT(*) n FROM question_attempts'), lessons: c("SELECT COUNT(*) n FROM lesson_progress WHERE status = 'completed'"),
      customCourses: c('SELECT COUNT(*) n FROM courses'), pendingCourses: c("SELECT COUNT(*) n FROM courses WHERE generated_by = 'ai' AND status = 'personal'"),
      topicRequests: c('SELECT COUNT(*) n FROM topic_requests'), openFlags: c("SELECT COUNT(*) n FROM flagged_content WHERE status = 'open'"),
      activeToday: c("SELECT COUNT(DISTINCT profile_id) n FROM activity_days WHERE day = date('now')"), active7: c("SELECT COUNT(DISTINCT profile_id) n FROM activity_days WHERE day >= date('now','-6 days')"),
    },
    health: { status: 'ok', uptimeSec: Math.round((Date.now() - started) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1048576), dbSizeKb: Math.round(dbSize / 1024), node: process.version, ai: { configured: aiConfigured(), model: aiConfigured() ? config.ai.model : null }, oauth: oauthConfigured, env: config.isProd ? 'production' : 'development' },
  });
});

// ─────────────────────────── users & profiles (admin)
adminRouter.get('/users', requireRole('admin'), (_req, res) => res.json({ users: listUsersWithCounts(), roles: ROLES }));
adminRouter.patch('/users/:id', requireRole('admin'), (req, res) => {
  const target = one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE id = ?', String(req.params.id));
  if (!target) throw notFound('User not found');
  if (target.id === req.user!.id) throw bad('You can’t change your own role or status.');
  if (hasRole({ ...req.user!, role: target.role }, 'admin') && req.user!.role !== 'super_admin') throw forbidden('Only a super admin can modify admins.');
  if (req.body?.role !== undefined) {
    const role = oneOf(req.body.role, 'role', ROLES);
    if ((role === 'admin' || role === 'super_admin') && req.user!.role !== 'super_admin') throw forbidden('Only a super admin can grant admin roles.');
    run('UPDATE users SET role = ? WHERE id = ?', role, target.id);
    audit(req.user!.id, 'user.role', target.id, { role });
  }
  if (req.body?.disabled !== undefined) {
    run('UPDATE users SET disabled = ? WHERE id = ?', req.body.disabled ? 1 : 0, target.id);
    if (req.body.disabled) run('DELETE FROM sessions WHERE user_id = ?', target.id);
    audit(req.user!.id, req.body.disabled ? 'user.disabled' : 'user.enabled', target.id);
  }
  res.json({ ok: true });
});
adminRouter.delete('/users/:id', requireRole('admin'), (req, res) => {
  if (String(req.params.id) === req.user!.id) throw bad('You can’t delete your own account here.');
  const target = one<{ role: Role }>('SELECT role FROM users WHERE id = ?', String(req.params.id));
  if (!target) throw notFound();
  if ((target.role === 'admin' || target.role === 'super_admin') && req.user!.role !== 'super_admin') throw forbidden();
  run('DELETE FROM users WHERE id = ?', String(req.params.id));
  audit(req.user!.id, 'user.deleted', String(req.params.id));
  res.json({ ok: true });
});
adminRouter.get('/users/:id/profiles', requireRole('admin'), (req, res) => {
  // Learning summaries only — never AI conversations or homework images.
  res.json({ profiles: all('SELECT id, name, school_grade, learning_level, onboarded, placement_done, created_at FROM profiles WHERE user_id = ?', String(req.params.id)) });
});
adminRouter.delete('/profiles/:id', requireRole('admin'), (req, res) => {
  run('DELETE FROM profiles WHERE id = ?', String(req.params.id));
  audit(req.user!.id, 'profile.deleted_by_admin', String(req.params.id));
  res.json({ ok: true });
});

// ─────────────────────────── courses (moderator)
adminRouter.get('/courses', (_req, res) => {
  const rows = all<{ id: string; title: string; description: string; data: string; generated_by: string; status: string; request_topic: string | null; created_at: string; owner_profile_id: string | null }>('SELECT * FROM courses ORDER BY created_at DESC LIMIT 200');
  res.json({ courses: rows.map((r) => { const c = json<Course & { validation?: unknown; notes?: string }>(r.data, null as unknown as Course); return { id: r.id, title: r.title, description: r.description, generatedBy: r.generated_by, status: r.status, topic: r.request_topic, createdAt: r.created_at, personal: !!r.owner_profile_id, units: c?.units.map((u) => ({ title: u.title, lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, skillId: l.skillId, generated: l.generated ? { objective: l.generated.objective, explanation: l.generated.explanation, practice: l.generated.practice.map((q) => ({ prompt: q.prompt, answer: q.answer, verify: q.verify.kind })) } : null })) })) ?? [], validation: c?.validation ?? null, notes: c?.notes ?? null }; }) });
});
adminRouter.post('/courses/:id/status', (req, res) => {
  const status = oneOf(req.body?.status, 'status', ['approved', 'rejected', 'personal', 'pending_review'] as const);
  const r = one<{ data: string }>('SELECT data FROM courses WHERE id = ?', String(req.params.id));
  if (!r) throw notFound();
  const data = json<Course>(r.data, null as unknown as Course); data.status = status === 'rejected' ? 'draft' : status;
  run("UPDATE courses SET status = ?, data = ?, updated_at = datetime('now') WHERE id = ?", status, JSON.stringify(data), String(req.params.id));
  audit(req.user!.id, `course.${status}`, String(req.params.id));
  res.json({ ok: true });
});
adminRouter.patch('/courses/:id', (req, res) => {
  const r = one<{ data: string }>('SELECT data FROM courses WHERE id = ?', String(req.params.id));
  if (!r) throw notFound();
  const data = json<Course>(r.data, null as unknown as Course);
  if (req.body?.title) data.title = str(req.body.title, 'Title', { max: 120 });
  if (req.body?.description !== undefined) data.description = str(req.body.description, 'Description', { optional: true, max: 1000 });
  run("UPDATE courses SET title = ?, description = ?, data = ?, updated_at = datetime('now') WHERE id = ?", data.title, data.description, JSON.stringify(data), String(req.params.id));
  audit(req.user!.id, 'course.edited', String(req.params.id));
  res.json({ ok: true });
});
adminRouter.delete('/courses/:id', (req, res) => {
  run('DELETE FROM courses WHERE id = ?', String(req.params.id)); run('DELETE FROM enrollments WHERE course_id = ?', String(req.params.id));
  audit(req.user!.id, 'course.deleted', String(req.params.id));
  res.json({ ok: true });
});
/** Create a catalog course from existing skills (admin-authored curriculum). */
adminRouter.post('/courses', (req, res) => {
  const title = str(req.body?.title, 'Title', { max: 120 });
  const description = str(req.body?.description, 'Description', { optional: true, max: 1000 });
  const band = str(req.body?.band, 'Level band', { optional: true, max: 40 }) || 'All levels';
  const unitsIn = Array.isArray(req.body?.units) ? req.body.units.slice(0, 20) : [];
  const units = unitsIn.map((u: { title: unknown; skills: unknown }, i: number) => ({ id: `u${i + 1}`, title: str(u.title, 'Unit title', { max: 80 }), lessons: strArray(u.skills, 'skills', { maxItems: 20, maxLen: 60 }).filter((s) => SKILL_MAP[s]).map((s) => ({ id: s, title: SKILL_MAP[s].title, skillId: s, kind: 'lesson' as const })) })).filter((u: { lessons: unknown[] }) => u.lessons.length);
  if (!units.length) throw bad('Add at least one unit with valid skills.');
  const id = randomUUID();
  const course: Course = { id, title, description, band, icon: '📘', difficulty: band, targetLevel: Math.max(...units.flatMap((u: { lessons: { skillId: string }[] }) => u.lessons.map((l) => SKILL_MAP[l.skillId].grade))), prerequisites: [], units, resources: [], masteryRules: { lessonPass: 70, unitPass: 75 }, generatedBy: 'curriculum', status: 'approved' };
  run('INSERT INTO courses (id, owner_profile_id, title, description, data, generated_by, status) VALUES (?, NULL, ?, ?, ?, ?, ?)', id, title, description, JSON.stringify(course), 'curriculum', 'approved');
  audit(req.user!.id, 'course.created', id);
  res.json({ id });
});

// ─────────────────────────── topic requests (moderator)
adminRouter.get('/topic-requests', (_req, res) => {
  const top = all<{ topic: string; n: number; last: string }>('SELECT normalized_topic AS topic, COUNT(*) n, MAX(created_at) last FROM topic_requests GROUP BY normalized_topic ORDER BY n DESC, last DESC LIMIT 50');
  const recent = all('SELECT id, topic, reason, level, style, status, course_id, created_at FROM topic_requests ORDER BY created_at DESC LIMIT 100');
  res.json({ top, recent });
});
adminRouter.patch('/topic-requests/:id', (req, res) => {
  run('UPDATE topic_requests SET status = ? WHERE id = ?', oneOf(req.body?.status, 'status', ['open', 'planned', 'done', 'declined'] as const), String(req.params.id));
  audit(req.user!.id, 'topic_request.status', String(req.params.id), { status: req.body?.status });
  res.json({ ok: true });
});

// ─────────────────────────── flagged content (moderator)
adminRouter.get('/flags', (_req, res) => res.json({ flags: all<{ snapshot: string | null }>('SELECT id, kind, ref, snapshot, reason, status, created_at FROM flagged_content ORDER BY status = \'open\' DESC, created_at DESC LIMIT 200').map((f) => ({ ...f, snapshot: f.snapshot ? json<{ prompt?: string; answer?: string; steps?: string[] }>(f.snapshot, {}) : null })) }));
adminRouter.patch('/flags/:id', (req, res) => {
  run('UPDATE flagged_content SET status = ? WHERE id = ?', oneOf(req.body?.status, 'status', ['open', 'resolved', 'dismissed'] as const), String(req.params.id));
  audit(req.user!.id, 'flag.status', String(req.params.id), { status: req.body?.status });
  res.json({ ok: true });
});

// ─────────────────────────── XP rules & achievements (admin)
adminRouter.get('/xp-rules', requireRole('admin'), (_req, res) => res.json({ rules: { ...DEFAULT_XP_RULES, ...getSetting('xp_rules', {}) }, labels: XP_RULE_LABELS, defaults: DEFAULT_XP_RULES }));
adminRouter.put('/xp-rules', requireRole('admin'), (req, res) => {
  const rules: Record<string, number> = {};
  for (const k of Object.keys(DEFAULT_XP_RULES)) if (req.body?.[k] !== undefined) rules[k] = num(req.body[k], XP_RULE_LABELS[k], { min: 0, max: 5000, int: true })!;
  setSetting('xp_rules', rules);
  audit(req.user!.id, 'xp_rules.updated', undefined, rules);
  res.json({ ok: true });
});
adminRouter.get('/achievements', requireRole('admin'), (_req, res) => {
  const disabled = new Set(getSetting<string[]>('disabled_achievements', [])); const xp = getSetting<Record<string, number>>('achievement_xp', {});
  const counts = Object.fromEntries(all<{ achievement_id: string; n: number }>('SELECT achievement_id, COUNT(*) n FROM user_achievements GROUP BY achievement_id').map((r) => [r.achievement_id, r.n]));
  res.json({ achievements: ACHIEVEMENTS.map((a) => ({ ...a, xp: xp[a.id] ?? a.xp, enabled: !disabled.has(a.id), unlockedBy: counts[a.id] ?? 0 })) });
});
adminRouter.put('/achievements/:id', requireRole('admin'), (req, res) => {
  if (!ACHIEVEMENTS.some((a) => a.id === String(req.params.id))) throw notFound();
  const disabled = new Set(getSetting<string[]>('disabled_achievements', [])); const xp = getSetting<Record<string, number>>('achievement_xp', {});
  if (req.body?.enabled !== undefined) { if (req.body.enabled) disabled.delete(String(req.params.id)); else disabled.add(String(req.params.id)); }
  if (req.body?.xp !== undefined) xp[String(req.params.id)] = num(req.body.xp, 'XP', { min: 0, max: 5000, int: true })!;
  setSetting('disabled_achievements', [...disabled]); setSetting('achievement_xp', xp);
  audit(req.user!.id, 'achievement.updated', String(req.params.id), req.body);
  res.json({ ok: true });
});

// ─────────────────────────── resources (admin)
adminRouter.get('/resources', (_req, res) => res.json({ resources: all<{ skill_ids: string }>('SELECT * FROM resources ORDER BY created_at DESC').map((r) => ({ ...r, skill_ids: json(r.skill_ids, []) })), domains: Object.keys(DOMAINS) }));
adminRouter.post('/resources', requireRole('admin'), (req, res) => {
  const url = str(req.body?.url, 'URL', { max: 500 });
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw bad('Resource URLs must start with https://');
  const id = randomUUID();
  run('INSERT INTO resources (id, title, url, source, kind, skill_ids, domain, difficulty, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, str(req.body?.title, 'Title', { max: 160 }), url, str(req.body?.source, 'Source', { max: 80 }),
    oneOf(req.body?.kind, 'Kind', ['video', 'article', 'interactive', 'course', 'book', 'tool'] as const, 'article'), JSON.stringify(strArray(req.body?.skillIds, 'skills', { maxItems: 20, maxLen: 60 }).filter((s) => SKILL_MAP[s])),
    req.body?.domain && DOMAINS[req.body.domain as keyof typeof DOMAINS] ? req.body.domain : null, str(req.body?.difficulty, 'Difficulty', { optional: true, max: 40 }) || null, str(req.body?.description, 'Description', { optional: true, max: 500 }) || null);
  audit(req.user!.id, 'resource.created', id);
  res.json({ id });
});
adminRouter.delete('/resources/:id', requireRole('admin'), (req, res) => { run('DELETE FROM resources WHERE id = ?', String(req.params.id)); audit(req.user!.id, 'resource.deleted', String(req.params.id)); res.json({ ok: true }); });

// ─────────────────────────── analytics & audit (admin)
adminRouter.get('/analytics', requireRole('admin'), (_req, res) => {
  const byEvent = all("SELECT event, COUNT(*) n FROM analytics_events WHERE created_at >= datetime('now','-30 days') GROUP BY event ORDER BY n DESC");
  const daily = all("SELECT date(created_at) day, COUNT(*) n FROM analytics_events WHERE created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day");
  const modes = all("SELECT json_extract(props,'$.mode') mode, COUNT(*) n FROM analytics_events WHERE event = 'question_answered' GROUP BY mode ORDER BY n DESC");
  const domains = all("SELECT json_extract(props,'$.domain') domain, COUNT(*) n, SUM(json_extract(props,'$.correct')) correct FROM analytics_events WHERE event = 'question_answered' GROUP BY domain ORDER BY n DESC");
  const retention = one("SELECT (SELECT COUNT(DISTINCT profile_id) FROM activity_days WHERE day >= date('now','-6 days')) AS week, (SELECT COUNT(DISTINCT profile_id) FROM activity_days WHERE day >= date('now','-13 days') AND day < date('now','-6 days')) AS prev_week");
  res.json({ byEvent, daily, modes, domains, retention });
});
adminRouter.get('/audit', requireRole('admin'), (_req, res) => res.json({ logs: all('SELECT a.id, a.action, a.target, a.details, a.created_at, u.email AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 200') }));
