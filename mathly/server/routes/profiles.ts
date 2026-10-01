import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AVATARS, CURRICULA, PROFILE_COLORS, gradeLabel, levelLabel } from '../../shared/curriculum.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import { all, audit, json, one, run, tx } from '../db.ts';
import { hashPassword, requireUser, verifyPassword, type ProfileRow } from '../auth.ts';
import { HttpError, bad, notFound, num, oneOf, str } from '../security.ts';
import { computeLearningLevel, masteryMap, profileSummary, streakInfo, topicMastery, totalXp } from '../learning.ts';
import { track } from '../analytics.ts';

export const profilesRouter = Router();
profilesRouter.use(requireUser);

const owned = (userId: string, id: string) => {
  const p = one<ProfileRow>('SELECT * FROM profiles WHERE id = ? AND user_id = ?', id, userId);
  if (!p) throw notFound('Profile not found');
  return p;
};

profilesRouter.get('/', (req, res) => {
  const rows = all<ProfileRow>('SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at', req.user!.id);
  res.json({ profiles: rows.map(profileSummary) });
});

profilesRouter.post('/', (req, res) => {
  const count = one<{ n: number }>('SELECT COUNT(*) n FROM profiles WHERE user_id = ?', req.user!.id)!.n;
  if (count >= 8) throw bad('You can have up to 8 learner profiles.');
  const name = str(req.body?.name, 'Name', { max: 40 });
  const avatar = AVATARS.includes(req.body?.avatar) ? req.body.avatar : AVATARS[count % AVATARS.length];
  const color = PROFILE_COLORS.includes(req.body?.color) ? req.body.color : PROFILE_COLORS[count % PROFILE_COLORS.length];
  const id = randomUUID();
  run('INSERT INTO profiles (id, user_id, name, avatar, color) VALUES (?, ?, ?, ?, ?)', id, req.user!.id, name, avatar, color);
  track('profile_created');
  res.json({ profile: profileSummary(owned(req.user!.id, id)) });
});

profilesRouter.patch('/:id', (req, res) => {
  const p = owned(req.user!.id, req.params.id);
  const b = req.body ?? {};
  const name = b.name !== undefined ? str(b.name, 'Name', { max: 40 }) : p.name;
  const avatar = b.avatar !== undefined ? str(b.avatar, 'Avatar', { max: 8 }) : p.avatar;
  const color = b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : p.color;
  const school = b.schoolGrade !== undefined ? num(b.schoolGrade, 'School level', { min: 0, max: 15, int: true, optional: true }) : p.school_grade;
  const curriculum = b.curriculum !== undefined ? oneOf(b.curriculum, 'Curriculum', CURRICULA.map((c) => c.id)) : p.curriculum;
  const dailyGoal = b.dailyGoalMin !== undefined ? num(b.dailyGoalMin, 'Daily goal', { min: 5, max: 180, int: true })! : p.daily_goal_min;
  run(`UPDATE profiles SET name = ?, avatar = ?, color = ?, school_grade = ?, curriculum = ?, daily_goal_min = ?, updated_at = datetime('now') WHERE id = ?`,
    name, avatar, color, school, curriculum, dailyGoal, p.id);
  res.json({ profile: profileSummary(owned(req.user!.id, p.id)) });
});

/** Parental PIN: protects settings / deletion for a child profile. */
profilesRouter.post('/:id/pin', async (req, res) => {
  const p = owned(req.user!.id, req.params.id);
  const pin = req.body?.pin;
  if (pin === null || pin === '') {
    if (p.pin_hash && !(await verifyPassword(String(req.body?.current ?? ''), p.pin_hash))) throw bad('Current PIN is incorrect.');
    run('UPDATE profiles SET pin_hash = NULL WHERE id = ?', p.id);
    return res.json({ ok: true });
  }
  if (!/^\d{4,6}$/.test(String(pin))) throw bad('PIN must be 4–6 digits.');
  if (p.pin_hash && !(await verifyPassword(String(req.body?.current ?? ''), p.pin_hash))) throw bad('Current PIN is incorrect.');
  run('UPDATE profiles SET pin_hash = ? WHERE id = ?', await hashPassword(String(pin)), p.id);
  res.json({ ok: true });
});
profilesRouter.post('/:id/verify-pin', async (req, res) => {
  const p = owned(req.user!.id, req.params.id);
  if (!p.pin_hash) return res.json({ ok: true });
  res.json({ ok: await verifyPassword(String(req.body?.pin ?? ''), p.pin_hash) });
});

profilesRouter.delete('/:id', async (req, res) => {
  const p = owned(req.user!.id, req.params.id);
  if (p.pin_hash && !(await verifyPassword(String(req.body?.pin ?? ''), p.pin_hash))) throw new HttpError(403, 'Enter the parental PIN to delete this profile.', 'pin_required');
  tx(() => run('DELETE FROM profiles WHERE id = ?', p.id));
  audit(req.user!.id, 'profile.deleted', p.id);
  res.json({ ok: true });
});

/** Data portability: everything we store about a learner profile, as JSON. */
profilesRouter.get('/:id/export', (req, res) => {
  const p = owned(req.user!.id, req.params.id);
  const q = (sql: string) => all(sql, p.id);
  const data = {
    exportedAt: new Date().toISOString(), app: 'Mathly',
    profile: { ...p, pin_hash: undefined, purposes: json(p.purposes, []), enjoys: json(p.enjoys, []), styles: json(p.styles, []), goals: json(p.goals, []), preferences: json(p.preferences, {}) },
    xp: totalXp(p.id), mastery: q('SELECT skill_id, score, attempts, correct, explain_score, confidence, last_practiced FROM mastery WHERE profile_id = ?'),
    attempts: q('SELECT skill_id, difficulty, correct, time_ms, hints_used, mode, created_at FROM question_attempts WHERE profile_id = ?'),
    lessons: q('SELECT lesson_key, stage, status, score, completed_at FROM lesson_progress WHERE profile_id = ?'),
    xpHistory: q('SELECT amount, reason, created_at FROM xp_transactions WHERE profile_id = ?'),
    achievements: q('SELECT achievement_id, unlocked_at FROM user_achievements WHERE profile_id = ?'),
    activity: q('SELECT day, seconds, questions FROM activity_days WHERE profile_id = ?'),
    courses: q('SELECT id, title, created_at FROM courses WHERE owner_profile_id = ?'),
    testPlans: q('SELECT title, test_date, skills, plan FROM test_plans WHERE profile_id = ?'),
    mockTests: q('SELECT score, started_at, completed_at FROM test_attempts WHERE profile_id = ?'),
    presentations: q('SELECT topic_title, mode, transcript, score, created_at FROM presentation_sessions WHERE profile_id = ?'),
    assignments: q('SELECT title, due_date, topic, tasks, done FROM assignments WHERE profile_id = ?'),
    homework: q('SELECT problem_text, completed, created_at FROM homework_sessions WHERE profile_id = ?'),
    tutorConversations: q('SELECT messages, updated_at FROM ai_conversations WHERE profile_id = ?'),
  };
  res.setHeader('Content-Disposition', `attachment; filename="mathly-${p.name.replace(/[^a-z0-9]/gi, '_')}-export.json"`);
  res.json(data);
});

// ─────────────────────────── Parent / teacher weekly report (account level; never includes AI chats)
export const familyRouter = Router();
familyRouter.use(requireUser);
familyRouter.get('/report', (req, res) => {
  const profiles = all<ProfileRow>('SELECT * FROM profiles WHERE user_id = ? ORDER BY created_at', req.user!.id);
  const reports = profiles.map((p) => {
    const week = one<{ s: number; q: number }>("SELECT COALESCE(SUM(seconds),0) s, COALESCE(SUM(questions),0) q FROM activity_days WHERE profile_id = ? AND day >= date('now','-6 days')", p.id)!;
    const prevAcc = one<{ c: number; n: number }>("SELECT COALESCE(SUM(correct),0) c, COUNT(*) n FROM question_attempts WHERE profile_id = ? AND created_at BETWEEN datetime('now','-14 days') AND datetime('now','-7 days')", p.id)!;
    const acc = one<{ c: number; n: number }>("SELECT COALESCE(SUM(correct),0) c, COUNT(*) n FROM question_attempts WHERE profile_id = ? AND created_at >= datetime('now','-7 days')", p.id)!;
    const mm = masteryMap(p.id);
    const lvl = computeLearningLevel(p.id);
    const topics = topicMastery(mm, p.school_grade != null && p.school_grade <= 12 ? Math.max(p.school_grade, Math.floor(lvl.overall ?? 0)) : 15);
    const lessonsDone = one<{ n: number }>("SELECT COUNT(*) n FROM lesson_progress WHERE profile_id = ? AND status = 'completed'", p.id)!.n;
    const days = all<{ day: string; seconds: number }>("SELECT day, seconds FROM activity_days WHERE profile_id = ? AND day >= date('now','-6 days') ORDER BY day", p.id);
    return {
      id: p.id, name: p.name, avatar: p.avatar, color: p.color, schoolLabel: gradeLabel(p.school_grade, p.curriculum),
      learningLevel: levelLabel(lvl.overall, p.curriculum), learningLevelValue: lvl.overall,
      minutes: Math.round(week.s / 60), questions: acc.n, accuracy: acc.n ? Math.round((acc.c / acc.n) * 100) : null,
      improvement: acc.n && prevAcc.n ? Math.round((acc.c / acc.n - prevAcc.c / prevAcc.n) * 100) : null,
      strongest: topics[0] ?? null, needsPractice: topics.length > 1 ? topics[topics.length - 1] : null, topics: topics.slice(0, 8),
      lessonsDone, streak: streakInfo(p.id).current, xp: totalXp(p.id), days,
      recentSkills: all<{ skill_id: string }>("SELECT DISTINCT skill_id FROM question_attempts WHERE profile_id = ? AND created_at >= datetime('now','-7 days') LIMIT 6", p.id).map((r) => SKILL_MAP[r.skill_id]?.title).filter(Boolean),
    };
  });
  res.json({ reports });
});
