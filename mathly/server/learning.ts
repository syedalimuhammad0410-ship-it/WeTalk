// The learning engine: mastery, learning levels, XP, streaks, achievements and recommendations.
import { randomUUID } from 'node:crypto';
import { SKILLS, SKILL_MAP } from '../shared/skills.ts';
import { ACHIEVEMENTS, CORE_COURSE_MAP, DEFAULT_XP_RULES, DOMAINS, ENJOY_DOMAINS, ageBandFor, gradeLabel, levelFromXp } from '../shared/curriculum.ts';
import type { Course, DomainId, ProfileSummary, SkillMeta } from '../shared/types.ts';
import { all, getSetting, json, one, run } from './db.ts';
import type { ProfileRow } from './auth.ts';

export const today = (d = new Date()) => d.toISOString().slice(0, 10);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ─────────────────────────────────────────── XP
export const xpRules = () => ({ ...DEFAULT_XP_RULES, ...getSetting<Record<string, number>>('xp_rules', {}) });
export function awardXp(profileId: string, rule: string, reasonText?: string, multiplier = 1): number {
  const amount = Math.round((xpRules()[rule] ?? 0) * multiplier);
  if (amount <= 0) return 0;
  run('INSERT INTO xp_transactions (profile_id, amount, reason) VALUES (?, ?, ?)', profileId, amount, reasonText ?? rule);
  return amount;
}
export function awardRawXp(profileId: string, amount: number, reason: string) {
  if (amount > 0) run('INSERT INTO xp_transactions (profile_id, amount, reason) VALUES (?, ?, ?)', profileId, Math.round(amount), reason);
  return amount;
}
export const totalXp = (profileId: string) => one<{ t: number }>('SELECT COALESCE(SUM(amount), 0) AS t FROM xp_transactions WHERE profile_id = ?', profileId)!.t;

// ─────────────────────────────────────────── Streaks (forgiving: automatic freezes)
export function recordActivity(profileId: string, seconds: number, questions = 0) {
  run(`INSERT INTO activity_days (profile_id, day, seconds, questions) VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, day) DO UPDATE SET seconds = seconds + excluded.seconds, questions = questions + excluded.questions`,
  profileId, today(), Math.max(0, Math.min(3600, Math.round(seconds))), questions);
}

export function streakInfo(profileId: string) {
  const days = all<{ day: string; frozen: number; seconds: number }>('SELECT day, frozen, seconds FROM activity_days WHERE profile_id = ? ORDER BY day DESC LIMIT 400', profileId);
  const active = new Set(days.map((d) => d.day));
  const dayStr = (offset: number) => today(new Date(Date.now() - offset * 86_400_000));
  const todayDone = active.has(dayStr(0));
  // Walk back from today (or yesterday if today isn't done yet). A single missed day can be covered by
  // a streak freeze; one freeze is earned for every 7 active days, max 2 banked.
  let current = 0, freezesUsed = 0, earned = 0, i = todayDone ? 0 : 1;
  while (i < 400) {
    if (active.has(dayStr(i))) { current++; if (current % 7 === 0) earned++; i++; continue; }
    const available = Math.min(2, earned) - freezesUsed;
    if (available > 0 && active.has(dayStr(i + 1))) { freezesUsed++; i++; continue; }
    break;
  }
  let best = 0, run_ = 0, prev: string | null = null;
  for (const d of [...active].sort()) {
    if (prev && (new Date(d).getTime() - new Date(prev).getTime()) / 86_400_000 === 1) run_++; else run_ = 1;
    best = Math.max(best, run_); prev = d;
  }
  const todaySeconds = days.find((d) => d.day === dayStr(0))?.seconds ?? 0;
  return { current, best: Math.max(best, current), todayDone, freezes: Math.max(0, Math.min(2, earned) - freezesUsed), freezesUsed, todayMinutes: Math.round(todaySeconds / 60) };
}

// ─────────────────────────────────────────── Mastery
export interface MasteryRow { skill_id: string; score: number; attempts: number; correct: number; streak: number; explain_score: number | null; confidence: number | null; estimated: number; last_practiced: string | null }
export interface MasteryView { skillId: string; score: number; effective: number; attempts: number; correct: number; estimated: boolean; lastPracticed: string | null; reviewDue: boolean; confidence: number | null }

export function effectiveMastery(m: Pick<MasteryRow, 'score' | 'correct' | 'last_practiced'>): number {
  if (!m.last_practiced) return m.score;
  const days = (Date.now() - new Date(m.last_practiced.replace(' ', 'T') + 'Z').getTime()) / 86_400_000;
  const halfLife = 10 * (1 + Math.min(m.correct, 30) / 6); // practice makes memories last longer
  const retention = Math.exp(-Math.max(0, days) / halfLife);
  return m.score * (0.55 + 0.45 * retention);
}

export function masteryMap(profileId: string): Record<string, MasteryView> {
  const rows = all<MasteryRow>('SELECT * FROM mastery WHERE profile_id = ?', profileId);
  const out: Record<string, MasteryView> = {};
  for (const r of rows) {
    const eff = effectiveMastery(r);
    out[r.skill_id] = { skillId: r.skill_id, score: Math.round(r.score), effective: Math.round(eff), attempts: r.attempts, correct: r.correct, estimated: !!r.estimated, lastPracticed: r.last_practiced, reviewDue: r.score >= 55 && eff < r.score - 12, confidence: r.confidence };
  }
  return out;
}

/** Mastery update after an attempt. Accuracy, difficulty, hints and repetition all matter. */
export function updateMastery(profileId: string, skillId: string, o: { correct: boolean; difficulty: number; hints: number }) {
  const cur = one<MasteryRow>('SELECT * FROM mastery WHERE profile_id = ? AND skill_id = ?', profileId, skillId);
  const score = cur?.score ?? 0; const attempts = cur?.attempts ?? 0;
  const perf = o.correct ? clamp(55 + 9 * o.difficulty - 8 * o.hints, 30, 100) : clamp(5 * o.difficulty - 2 * o.hints, 0, 25);
  // Estimated (placement) mastery is trusted less, so real evidence moves it faster.
  const alpha = cur?.estimated ? 0.4 : attempts < 3 ? 0.35 : attempts < 10 ? 0.25 : 0.18;
  const base = cur ? effectiveMastery(cur) : 0;
  const next = clamp(base + alpha * (perf - base), 0, 100);
  run(`INSERT INTO mastery (profile_id, skill_id, score, attempts, correct, streak, estimated, last_practiced) VALUES (?, ?, ?, 1, ?, ?, 0, datetime('now'))
       ON CONFLICT(profile_id, skill_id) DO UPDATE SET score = excluded.score, attempts = attempts + 1, correct = correct + excluded.correct,
       streak = CASE WHEN excluded.correct = 1 THEN streak + 1 ELSE 0 END, estimated = 0, last_practiced = datetime('now')`,
  profileId, skillId, next, o.correct ? 1 : 0, o.correct ? 1 : 0);
  return { before: Math.round(base), after: Math.round(next) };
}

export function setExplainScore(profileId: string, skillId: string, score: number) {
  run(`INSERT INTO mastery (profile_id, skill_id, score, explain_score, last_practiced) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(profile_id, skill_id) DO UPDATE SET explain_score = excluded.explain_score, score = MIN(100, score + ?)`,
  profileId, skillId, score * 0.2, score, score >= 70 ? 3 : 0);
}
export function setConfidence(profileId: string, skillId: string, confidence: number) {
  run(`INSERT INTO mastery (profile_id, skill_id, confidence) VALUES (?, ?, ?) ON CONFLICT(profile_id, skill_id) DO UPDATE SET confidence = excluded.confidence`, profileId, skillId, confidence);
}

/** Difficulty to serve next, from current mastery (and self-reported confidence). */
export function targetDifficulty(m?: MasteryView, confidence?: number | null) {
  let d = 1 + (m?.effective ?? 0) / 22;
  if (confidence != null) d += (confidence - 2) * 0.3; // 0..3 scale
  return clamp(Math.round(d), 1, 5);
}

// ─────────────────────────────────────────── Learning level
const LEVEL_DOMAINS: DomainId[] = ['number', 'fractions', 'ratios', 'algebra', 'functions', 'geometry', 'statistics', 'probability', 'trigonometry', 'calculus', 'linear-algebra', 'discrete', 'realworld'];

export function domainLevels(mm: Record<string, MasteryView>) {
  const out: Partial<Record<DomainId, number>> = {};
  for (const dom of Object.keys(DOMAINS) as DomainId[]) {
    const skills = SKILLS.filter((s) => s.domain === dom);
    if (!skills.some((s) => mm[s.id])) continue;
    const grades = [...new Set(skills.map((s) => s.grade))].sort((a, b) => a - b);
    let level = grades[0];
    for (let i = 0; i < grades.length; i++) {
      const g = grades[i]; const span = (grades[i + 1] ?? g + 1) - g;
      const atG = skills.filter((s) => s.grade === g);
      const m = atG.reduce((s, sk) => s + (mm[sk.id]?.effective ?? 0), 0) / atG.length;
      if (m >= 70) { level = g + span; continue; }
      level = g + span * clamp(m / 70, 0, 1) * 0.99;
      break;
    }
    out[dom] = Math.round(level * 10) / 10;
  }
  return out;
}

export function computeLearningLevel(profileId: string) {
  const mm = masteryMap(profileId);
  const levels = domainLevels(mm);
  let wSum = 0, lSum = 0;
  for (const d of LEVEL_DOMAINS) {
    if (levels[d] === undefined) continue;
    const known = SKILLS.filter((s) => s.domain === d && mm[s.id]).length;
    wSum += known; lSum += known * levels[d]!;
  }
  const overall = wSum ? Math.round((lSum / wSum) * 10) / 10 : null;
  run("UPDATE profiles SET learning_level = ?, updated_at = datetime('now') WHERE id = ?", overall, profileId);
  return { overall, domains: levels };
}

/** Topic mastery % relative to a grade (e.g. "Fractions: 71%"). */
export function topicMastery(mm: Record<string, MasteryView>, uptoGrade: number) {
  const out: { domain: DomainId; name: string; icon: string; percent: number; skills: number }[] = [];
  for (const dom of Object.keys(DOMAINS) as DomainId[]) {
    const skills = SKILLS.filter((s) => s.domain === dom && s.grade <= uptoGrade);
    if (!skills.length) continue;
    const pct = skills.reduce((s, sk) => s + (mm[sk.id]?.effective ?? 0), 0) / skills.length;
    if (!skills.some((s) => mm[s.id])) continue;
    out.push({ domain: dom, name: DOMAINS[dom].name, icon: DOMAINS[dom].icon, percent: Math.round(pct), skills: skills.length });
  }
  return out.sort((a, b) => b.percent - a.percent);
}

// ─────────────────────────────────────────── Recommendations ("what should I learn next?")
export interface Recommendation { skillId: string; title: string; domain: DomainId; kind: 'next' | 'review' | 'targeted' | 'course' | 'challenge'; reason: string; minutes: number; mastery: number; courseId?: string }

export function prereqsMet(s: SkillMeta, mm: Record<string, MasteryView>, level: number) {
  return s.prereqs.every((p) => {
    const m = mm[p]; const ps = SKILL_MAP[p];
    if (m) return m.effective >= 55;
    return ps ? ps.grade <= level - 1.5 : true; // well below the learner's level → assume known
  });
}

export function recommendations(profile: ProfileRow, limit = 4): Recommendation[] {
  const mm = masteryMap(profile.id);
  const level = profile.learning_level ?? profile.school_grade ?? 5;
  const enjoys = new Set(json<string[]>(profile.enjoys, []).flatMap((e) => ENJOY_DOMAINS[e] ?? []));
  const isUni = (profile.school_grade ?? 0) >= 13;
  const recent = all<{ skill_id: string; n: number; c: number }>(`SELECT skill_id, COUNT(*) n, SUM(correct) c FROM question_attempts WHERE profile_id = ? AND created_at > datetime('now','-7 days') GROUP BY skill_id`, profile.id);
  const struggling = new Set(recent.filter((r) => r.n >= 3 && r.c / r.n < 0.5).map((r) => r.skill_id));
  const courseSkills = currentCourseSkills(profile);

  const scored: (Recommendation & { score: number })[] = [];
  for (const s of SKILLS) {
    const m = mm[s.id];
    const eff = m?.effective ?? 0;
    if (!isUni && s.grade >= 13 && level < 11.5) continue;
    if (struggling.has(s.id)) { scored.push({ skillId: s.id, title: s.title, domain: s.domain, kind: 'targeted', reason: 'Targeted practice — a few recent questions were tricky', minutes: 10, mastery: Math.round(eff), score: 9 }); continue; }
    if (m?.reviewDue) { scored.push({ skillId: s.id, title: s.title, domain: s.domain, kind: 'review', reason: `Quick review — it’s been a while since you practiced`, minutes: 5, mastery: Math.round(eff), score: 6 + (m.score - eff) / 10 }); continue; }
    if (eff >= 80) continue;
    if (!prereqsMet(s, mm, level)) continue;
    let score = 5 - Math.abs(s.grade - (level + 0.4)) * 1.2;
    if (s.grade < level - 2 && !m) continue; // far below level and untested: skip
    if (enjoys.has(s.domain)) score += 0.8;
    const inCourse = courseSkills.indexOf(s.id);
    if (inCourse >= 0) score += 3 - inCourse * 0.05;
    if (m && m.attempts > 0 && eff < 80) score += 1.2; // finish what you started
    if (['mental', 'puzzles', 'realworld'].includes(s.domain)) score -= 0.8;
    const reason = inCourse >= 0 ? 'Next in your course' : m?.attempts ? `Keep going — you’re at ${Math.round(eff)}%` : s.prereqs.length ? `Builds on ${SKILL_MAP[s.prereqs[0]]?.title ?? 'what you know'}` : 'A great next step';
    scored.push({ skillId: s.id, title: s.title, domain: s.domain, kind: inCourse >= 0 ? 'course' : 'next', reason, minutes: 15, mastery: Math.round(eff), score });
  }
  scored.sort((a, b) => b.score - a.score);
  // Diversity: avoid 3 recommendations from the same domain
  const out: Recommendation[] = []; const perDomain: Record<string, number> = {};
  for (const r of scored) {
    if ((perDomain[r.domain] ?? 0) >= 2) continue;
    perDomain[r.domain] = (perDomain[r.domain] ?? 0) + 1;
    const { score: _s, ...rest } = r; out.push(rest);
    if (out.length >= limit) break;
  }
  return out;
}

export function currentCourseSkills(profile: ProfileRow): string[] {
  const enrolled = all<{ course_id: string }>('SELECT course_id FROM enrollments WHERE profile_id = ? ORDER BY COALESCE(last_opened, created_at) DESC LIMIT 2', profile.id).map((e) => e.course_id);
  if (profile.current_course && !enrolled.includes(profile.current_course)) enrolled.unshift(profile.current_course);
  const mm = masteryMap(profile.id);
  const skills: string[] = [];
  for (const cid of enrolled) {
    const c = getCourse(cid, profile.id);
    if (!c) continue;
    for (const u of c.units) for (const l of u.lessons) if (l.skillId && !skills.includes(l.skillId) && (mm[l.skillId]?.effective ?? 0) < 80) skills.push(l.skillId);
  }
  return skills;
}

export function getCourse(id: string, profileId?: string): Course | null {
  if (CORE_COURSE_MAP[id]) return CORE_COURSE_MAP[id];
  const row = one<{ data: string; status: string; owner_profile_id: string | null }>('SELECT data, status, owner_profile_id FROM courses WHERE id = ?', id);
  if (!row) return null;
  if (row.status !== 'approved' && row.owner_profile_id !== profileId) return null;
  return { ...json<Course>(row.data, null as unknown as Course), status: row.status as Course['status'] };
}

// ─────────────────────────────────────────── Achievements
export function checkAchievements(profileId: string): typeof ACHIEVEMENTS {
  const have = new Set(all<{ achievement_id: string }>('SELECT achievement_id FROM user_achievements WHERE profile_id = ?', profileId).map((r) => r.achievement_id));
  const disabled = new Set(getSetting<string[]>('disabled_achievements', []));
  const p = one<ProfileRow>('SELECT * FROM profiles WHERE id = ?', profileId);
  if (!p) return [];
  const stat = (sql: string) => (one<{ n: number }>(sql, profileId)?.n ?? 0);
  const correct = stat('SELECT COUNT(*) n FROM question_attempts WHERE profile_id = ? AND correct = 1');
  const streak = streakInfo(profileId).current;
  const mm = masteryMap(profileId);
  const conds: Record<string, () => boolean> = {
    first_lesson: () => stat("SELECT COUNT(*) n FROM lesson_progress WHERE profile_id = ? AND status = 'completed'") >= 1,
    placement: () => !!p.placement_done,
    streak_3: () => streak >= 3, streak_7: () => streak >= 7, streak_30: () => streak >= 30,
    problems_100: () => correct >= 100, problems_1000: () => correct >= 1000,
    one_grade_ahead: () => p.school_grade != null && p.school_grade <= 12 && (p.learning_level ?? 0) >= p.school_grade + 1,
    perfect_practice: () => {
      const last = all<{ correct: number; hints_used: number }>('SELECT correct, hints_used FROM question_attempts WHERE profile_id = ? ORDER BY id DESC LIMIT 10', profileId);
      return last.length === 10 && last.every((a) => a.correct && !a.hints_used);
    },
    geometry_explorer: () => SKILLS.filter((s) => s.domain === 'geometry' && (mm[s.id]?.effective ?? 0) >= 60 && !mm[s.id]?.estimated).length >= 4,
    mental_master: () => stat("SELECT COUNT(*) n FROM question_attempts WHERE profile_id = ? AND correct = 1 AND (mode = 'mental' OR skill_id LIKE 'mental-%')") >= 50,
    confident_presenter: () => stat('SELECT COUNT(*) n FROM presentation_sessions WHERE profile_id = ? AND score >= 80') >= 1,
    math_explorer: () => (one<{ n: number }>("SELECT COUNT(DISTINCT skill_id) n FROM question_attempts WHERE profile_id = ?", profileId)?.n ?? 0) >= 6 && new Set(all<{ skill_id: string }>('SELECT DISTINCT skill_id FROM question_attempts WHERE profile_id = ?', profileId).map((r) => SKILL_MAP[r.skill_id]?.domain)).size >= 6,
    course_creator: () => stat('SELECT COUNT(*) n FROM courses WHERE owner_profile_id = ?') >= 1,
    explainer: () => stat("SELECT COUNT(*) n FROM xp_transactions WHERE profile_id = ? AND reason LIKE 'Explained%'") >= 10,
    test_ready: () => stat('SELECT COUNT(*) n FROM test_attempts WHERE profile_id = ? AND score >= 80') >= 1,
    homework_hero: () => stat('SELECT COUNT(*) n FROM homework_sessions WHERE profile_id = ? AND completed = 1') >= 5,
    daily_7: () => stat('SELECT COUNT(*) n FROM daily_challenges WHERE profile_id = ? AND solved = 1') >= 7,
  };
  const unlocked: typeof ACHIEVEMENTS = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || disabled.has(a.id)) continue;
    if (conds[a.id]?.()) {
      run('INSERT OR IGNORE INTO user_achievements (profile_id, achievement_id) VALUES (?, ?)', profileId, a.id);
      const xp = getSetting<Record<string, number>>('achievement_xp', {})[a.id] ?? a.xp;
      awardRawXp(profileId, xp, `Achievement: ${a.title}`);
      notify(profileId, 'achievement', `Achievement unlocked: ${a.title}`, a.description, '/progress', `ach:${a.id}`);
      unlocked.push(a);
    }
  }
  return unlocked;
}

// ─────────────────────────────────────────── Notifications
export function notify(profileId: string, kind: string, title: string, body?: string, link?: string, dedupeKey?: string) {
  const prefs = json<{ notifications?: Record<string, boolean> }>(one<{ preferences: string }>('SELECT preferences FROM profiles WHERE id = ?', profileId)?.preferences, {});
  if (prefs.notifications?.[kind] === false || prefs.notifications?.all === false) return;
  run('INSERT OR IGNORE INTO notifications (id, profile_id, kind, title, body, link, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?)', randomUUID(), profileId, kind, title, body ?? null, link ?? null, dedupeKey ?? null);
}

/** Generate timely reminders (idempotent per day via dedupe keys). */
export function notificationSweep(profile: ProfileRow) {
  const day = today();
  const st = streakInfo(profile.id);
  if (!st.todayDone) notify(profile.id, 'daily_goal', 'Your daily math goal is waiting', `${profile.daily_goal_min} minutes today keeps your ${st.current ? `${st.current}-day streak` : 'momentum'} going.`, '/', `goal:${day}`);
  for (const t of all<{ id: string; title: string; test_date: string }>('SELECT id, title, test_date FROM test_plans WHERE profile_id = ? AND archived = 0', profile.id)) {
    const days = Math.round((new Date(t.test_date).getTime() - new Date(day).getTime()) / 86_400_000);
    if (days >= 0 && days <= 7) notify(profile.id, 'test', days === 0 ? `Test day: ${t.title}` : `You have a test in ${days} day${days === 1 ? '' : 's'}`, `${t.title} — check today’s study plan.`, `/test-prep/${t.id}`, `test:${t.id}:${day}`);
  }
  const review = Object.values(masteryMap(profile.id)).filter((m) => m.reviewDue).slice(0, 1)[0];
  if (review) notify(profile.id, 'review', `Your ${SKILL_MAP[review.skillId]?.title ?? 'skill'} review is ready`, 'A quick 5-minute review keeps it fresh.', `/practice?skill=${review.skillId}&mode=practice`, `review:${review.skillId}:${day.slice(0, 7)}`);
  for (const a of all<{ id: string; title: string; due_date: string }>("SELECT id, title, due_date FROM assignments WHERE profile_id = ? AND done = 0 AND due_date IS NOT NULL", profile.id)) {
    const days = Math.round((new Date(a.due_date).getTime() - new Date(day).getTime()) / 86_400_000);
    if (days >= 0 && days <= 2) notify(profile.id, 'homework', `${a.title} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in 2 days'}`, 'Open your organizer to see the next task.', '/organizer', `hw:${a.id}:${day}`);
  }
}

// ─────────────────────────────────────────── Profile summary
export function profileSummary(p: ProfileRow): ProfileSummary {
  const xp = totalXp(p.id);
  return {
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, schoolGrade: p.school_grade, schoolLabel: gradeLabel(p.school_grade, p.curriculum),
    learningLevel: p.learning_level, ageBand: ageBandFor(p.school_grade), xp, level: levelFromXp(xp).level, streak: streakInfo(p.id).current,
    onboarded: !!p.onboarded, placementDone: !!p.placement_done, hasPin: !!p.pin_hash, curriculum: p.curriculum, dailyGoalMin: p.daily_goal_min,
  };
}

/** Infer mastery for skills from placement abilities (marked as estimated). */
export function seedEstimatedMastery(profileId: string, abilities: Partial<Record<DomainId, number>>) {
  for (const s of SKILLS) {
    const theta = abilities[s.domain];
    if (theta === undefined) continue;
    const gap = theta - s.grade;
    const est = gap >= 1.5 ? 85 : gap >= 0.5 ? 72 : gap >= -0.5 ? 50 : gap >= -1.5 ? 25 : 0;
    if (!est) continue;
    run(`INSERT INTO mastery (profile_id, skill_id, score, estimated) VALUES (?, ?, ?, 1)
         ON CONFLICT(profile_id, skill_id) DO UPDATE SET score = CASE WHEN estimated = 1 OR attempts = 0 THEN excluded.score ELSE score END,
         estimated = CASE WHEN attempts = 0 THEN 1 ELSE estimated END`, profileId, s.id, est);
  }
}
