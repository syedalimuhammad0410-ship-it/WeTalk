// Core learning API: dashboard, onboarding, placement, skill tree, courses, lessons, questions,
// daily challenge, progress, preferences, search, notifications, resources.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import type { Course, DomainId, Question } from '../../shared/types.ts';
import { SKILLS, SKILL_MAP } from '../../shared/skills.ts';
import { ACHIEVEMENTS, CORE_COURSES, CURRICULA, DOMAINS, ONBOARDING, PLACEMENT_DOMAINS, UNLOCKS, ACCENT_THEMES, gradeLabel, levelFromXp, levelLabel } from '../../shared/curriculum.ts';
import { all, json, one, run } from '../db.ts';
import { requireProfile, type ProfileRow } from '../auth.ts';
import { bad, notFound, num, oneOf, str, strArray } from '../security.ts';
import { generateQuestion, toPublic } from '../engine/index.ts';
import { checkAnswer } from '../engine/check.ts';
import { hashString, makeRng } from '../engine/util.ts';
import {
  awardRawXp, awardXp, checkAchievements, computeLearningLevel, getCourse, masteryMap, notificationSweep, prereqsMet, profileSummary, recommendations,
  recordActivity, seedEstimatedMastery, setConfidence, setExplainScore, streakInfo, targetDifficulty, today, topicMastery, totalXp, updateMastery, domainLevels,
} from '../learning.ts';
import { evaluateExplanation } from '../ai/tutor.ts';
import { aiConfigured } from '../ai/provider.ts';
import { track } from '../analytics.ts';

export const learnRouter = Router();
learnRouter.use(requireProfile);
const P = (req: Request) => req.profile!;
const prefsOf = (p: ProfileRow) => json<Record<string, unknown>>(p.preferences, {});
const optOut = (p: ProfileRow) => prefsOf(p).analyticsOptOut === true;

// ─────────────────────────────────────────── issuing questions
export function issueQuestion(profileId: string, q: Question, context: string) {
  run('INSERT INTO issued_questions (id, profile_id, skill_id, payload, context) VALUES (?, ?, ?, ?, ?)', q.id, profileId, q.skillId, JSON.stringify(q), context);
  return toPublic(q);
}
export function loadIssued(profileId: string, id: string) {
  const row = one<{ id: string; payload: string; context: string; hints_used: number; attempts: number; solved: number; revealed: number; created_at: string }>('SELECT * FROM issued_questions WHERE id = ? AND profile_id = ?', id, profileId);
  if (!row) throw notFound('That question has expired. Let’s get a fresh one.');
  return { ...row, q: json<Question>(row.payload, null as unknown as Question) };
}

const MODES = ['practice', 'mental', 'puzzle', 'game', 'visual', 'tutor', 'challenge', 'speed', 'realworld', 'review', 'targeted', 'lesson', 'daily'] as const;
type Mode = (typeof MODES)[number];

function pickSkillForMode(p: ProfileRow, mode: Mode, mm: ReturnType<typeof masteryMap>, rng: () => number): string {
  const level = p.learning_level ?? p.school_grade ?? 5;
  const near = (filter: (s: (typeof SKILLS)[number]) => boolean, lo = -2, hi = 0.8) => {
    let pool = SKILLS.filter((s) => filter(s) && s.grade <= level + hi && s.grade >= level + lo);
    if (!pool.length) pool = SKILLS.filter(filter).sort((a, b) => Math.abs(a.grade - level) - Math.abs(b.grade - level)).slice(0, 4);
    return pool[Math.floor(rng() * pool.length)]?.id;
  };
  switch (mode) {
    case 'mental': return near((s) => s.domain === 'mental' || ['k-add10', 'add-2digit', 'mult-facts', 'div-facts', 'negatives', 'percent-of', 'exponents'].includes(s.id), -6, 0.5) ?? 'mental-add';
    case 'speed': return near((s) => ['number', 'mental', 'fractions'].includes(s.domain) && !s.calculator, -4, 0.3) ?? 'mult-facts';
    case 'puzzle': return near((s) => s.domain === 'puzzles' || ['logic-truth', 'primes-factors', 'counting', 'modular'].includes(s.id), -8, 2) ?? 'sequences-next';
    case 'visual': return near((s) => !!s.visual, -4, 1) ?? 'frac-intro';
    case 'realworld': return near((s) => s.domain === 'realworld', -4, 1.5) ?? 'money';
    case 'challenge': return near((s) => !['mental', 'puzzles'].includes(s.domain), 0.5, 2.5) ?? 'two-step-eq';
    case 'review': {
      const due = Object.values(mm).filter((m) => m.reviewDue).map((m) => m.skillId);
      return due[Math.floor(rng() * due.length)] ?? recommendations(p, 1)[0]?.skillId ?? 'two-step-eq';
    }
    default: {
      const recs = recommendations(p, 3);
      if (mode === 'game' && rng() < 0.5) return near((s) => !s.calculator, -3, 0.5) ?? recs[0]?.skillId ?? 'mult-facts';
      return recs[Math.floor(rng() * Math.max(1, recs.length))]?.skillId ?? near(() => true) ?? 'two-step-eq';
    }
  }
}

learnRouter.post('/questions/next', (req, res) => {
  const p = P(req);
  const mode = oneOf(req.body?.mode, 'mode', MODES, 'practice');
  const mm = masteryMap(p.id);
  const stage = typeof req.body?.stage === 'string' ? req.body.stage : '';
  // Generated (AI) course lessons draw from their validated question bank.
  if (req.body?.courseId && req.body?.lessonId) {
    const course = getCourse(String(req.body.courseId), p.id);
    const lesson = course?.units.flatMap((u) => u.lessons).find((l) => l.id === req.body.lessonId);
    if (lesson?.generated) {
      const bank = stage === 'challenge' && lesson.generated.challenge ? [lesson.generated.challenge] : lesson.generated.practice;
      if (!bank.length) throw bad('This lesson has no practice questions.');
      const base = bank[Math.floor(Math.random() * bank.length)];
      return res.json({ question: issueQuestion(p.id, { ...base, id: randomUUID() }, `course:${course!.id}`) });
    }
  }
  let skillId = typeof req.body?.skillId === 'string' && SKILL_MAP[req.body.skillId] ? req.body.skillId : pickSkillForMode(p, mode, mm, Math.random);
  if (!SKILL_MAP[skillId]) skillId = 'two-step-eq';
  const m = mm[skillId];
  let d = req.body?.difficulty ? num(req.body.difficulty, 'difficulty', { min: 1, max: 5, int: true })! : targetDifficulty(m, m?.confidence ?? null);
  if (stage === 'try' || stage === 'example') d = Math.max(1, Math.min(d, 2));
  if (stage === 'challenge' || mode === 'challenge') d = Math.min(5, Math.max(d + 1, 4));
  if (mode === 'targeted') d = Math.max(1, d - 1);
  const q = generateQuestion(skillId, d);
  res.json({ question: issueQuestion(p.id, q, mode) });
});

learnRouter.post('/questions/:id/answer', (req, res) => {
  const p = P(req);
  const iq = loadIssued(p.id, req.params.id);
  const response = str(req.body?.response, 'Answer', { max: 300 });
  const timeMs = num(req.body?.timeMs, 'time', { min: 0, max: 3_600_000, optional: true }) ?? 0;
  const confidence = num(req.body?.confidence, 'confidence', { min: 0, max: 3, int: true, optional: true });
  const mode = oneOf(req.body?.mode, 'mode', [...MODES, 'placement', 'mock'] as const, 'practice');
  if (iq.solved) return res.json({ correct: true, feedback: 'Already solved — on to the next one!', alreadySolved: true });
  const q = iq.q;
  const result = checkAnswer(q, response);
  const attempts = iq.attempts + 1;
  const first = iq.attempts === 0;
  run('UPDATE issued_questions SET attempts = ?, solved = ? WHERE id = ?', attempts, result.correct ? 1 : 0, iq.id);

  let xp = 0; let masteryChange: { before: number; after: number } | null = null;
  const levelBefore = levelFromXp(totalXp(p.id)).level;
  if (first && !result.nudge) {
    run('INSERT INTO question_attempts (profile_id, question_id, skill_id, difficulty, correct, time_ms, hints_used, confidence, mistake_type, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.id, q.id, q.skillId, q.difficulty, result.correct ? 1 : 0, timeMs, iq.hints_used, confidence, result.mistakeType ?? null, mode);
    if (!q.skillId.startsWith('gen:')) masteryChange = updateMastery(p.id, q.skillId, { correct: result.correct, difficulty: q.difficulty, hints: iq.hints_used });
    if (confidence != null) setConfidence(p.id, q.skillId, confidence);
  }
  if (result.correct && !iq.revealed) {
    if (iq.context === 'daily') {
      run('UPDATE daily_challenges SET solved = 1 WHERE profile_id = ? AND question_id = ?', p.id, q.id);
      xp += awardXp(p.id, 'daily_challenge', 'Daily challenge');
    } else if (first && iq.hints_used === 0) xp += awardXp(p.id, q.difficulty >= 4 ? 'hard_correct' : 'practice_correct', q.difficulty >= 4 ? 'Difficult question' : 'Practice question');
    else xp += awardRawXp(p.id, 5, 'Practice question (with help)');
  }
  recordActivity(p.id, Math.min(180, timeMs / 1000), first ? 1 : 0);
  const lvl = computeLearningLevel(p.id);
  const unlocked = checkAchievements(p.id);
  const levelAfter = levelFromXp(totalXp(p.id)).level;
  const showSolution = result.correct || attempts >= 3;
  track('question_answered', { mode, correct: result.correct, domain: SKILL_MAP[q.skillId]?.domain ?? 'custom' }, optOut(p));
  res.json({
    correct: result.correct, feedback: result.feedback, mistakeType: result.mistakeType, nudge: !!result.nudge, attempts,
    solution: showSolution ? { answer: q.answer, unit: q.unit, steps: q.steps, explanation: q.explanation } : null,
    xp, mastery: masteryChange, learningLevel: lvl.overall, achievements: unlocked, levelUp: levelAfter > levelBefore ? levelAfter : null,
  });
});

/** The anti-cheating help ladder. Each level reveals a little more. */
learnRouter.post('/questions/:id/help', (req, res) => {
  const p = P(req);
  const iq = loadIssued(p.id, req.params.id);
  const level = num(req.body?.level, 'level', { min: 1, max: 6, int: true })!;
  const q = iq.q; const skill = SKILL_MAP[q.skillId];
  run('UPDATE issued_questions SET hints_used = MAX(hints_used, ?), revealed = CASE WHEN ? = 6 THEN 1 ELSE revealed END WHERE id = ?', level >= 2 ? level - 1 : 0, level, iq.id);
  track('help_used', { kind: String(level) }, optOut(p));
  const understand = q.steps.find((s) => s.startsWith('UNDERSTAND'))?.replace('UNDERSTAND: ', '');
  switch (level) {
    case 1: return res.json({ level, kind: 'think', title: 'What do you think?', text: `Before any hints: ${understand ?? 'what is the question asking?'} What would you try first? Type your idea to the tutor, or take a guess — mistakes help you learn.` });
    case 2: return res.json({ level, kind: 'hint', title: 'Small hint', text: q.hints[0] });
    case 3: return res.json({ level, kind: 'concept', title: skill ? `Concept: ${skill.title}` : 'Concept', text: `${skill ? `${skill.learn.join(' ')}\n\nKey idea: ${skill.keyIdea}` : ''}${q.hints[1] ? `\n\n${q.hints[1]}` : ''}`.trim() });
    case 4: return res.json({ level, kind: 'step', title: 'Next step', text: (q.steps.find((s) => s.startsWith('PLAN')) ?? q.steps[0]).replace(/^PLAN: /, 'Plan: ') + '\n' + (q.hints[2] ?? q.steps.find((s) => s.startsWith('SOLVE'))?.replace('SOLVE: ', '') ?? '') });
    case 5: {
      if (q.skillId.startsWith('gen:') || !skill) return res.json({ level, kind: 'example', title: 'Worked example', text: q.steps.slice(0, 2).join('\n') });
      const ex = generateQuestion(q.skillId, q.difficulty);
      return res.json({ level, kind: 'example', title: 'A similar example', example: { prompt: ex.prompt, steps: ex.steps, answer: ex.answer, unit: ex.unit, visual: ex.visual } });
    }
    default: return res.json({ level, kind: 'solution', title: 'Full solution', solution: { answer: q.answer, unit: q.unit, steps: q.steps, explanation: q.explanation } });
  }
});

// ─────────────────────────────────────────── dashboard
learnRouter.get('/dashboard', (req, res) => {
  const p = P(req);
  notificationSweep(p);
  const xp = totalXp(p.id); const lv = levelFromXp(xp);
  const recs = recommendations(p, 3);
  const cont = one<{ lesson_key: string; stage: string; updated_at: string }>("SELECT lesson_key, stage, updated_at FROM lesson_progress WHERE profile_id = ? AND status = 'in_progress' AND lesson_key != 'placement' ORDER BY updated_at DESC LIMIT 1", p.id);
  const mm = masteryMap(p.id);
  let continueLearning = null;
  if (cont) {
    const [courseId, lessonId] = cont.lesson_key.includes(':') ? cont.lesson_key.split(':') : [null, cont.lesson_key];
    const skill = SKILL_MAP[lessonId];
    const course = courseId ? getCourse(courseId, p.id) : null;
    const gl = course?.units.flatMap((u) => u.lessons).find((l) => l.id === lessonId);
    const STAGES = ['learn', 'example', 'try', 'practice', 'challenge', 'explain', 'check'];
    continueLearning = { lessonKey: cont.lesson_key, title: skill?.title ?? gl?.title ?? 'Lesson', stage: cont.stage, progress: Math.round(((STAGES.indexOf(cont.stage) + 1) / STAGES.length) * 100), mastery: skill ? mm[skill.id]?.effective ?? 0 : null, link: courseId ? `/learn/${courseId}/lesson/${lessonId}` : `/lesson/${lessonId}` };
  }
  const daily = one<{ solved: number }>('SELECT solved FROM daily_challenges WHERE profile_id = ? AND day = ?', p.id, today());
  const tests = all<{ id: string; title: string; test_date: string }>("SELECT id, title, test_date FROM test_plans WHERE profile_id = ? AND archived = 0 AND test_date >= date('now') ORDER BY test_date LIMIT 3", p.id);
  const unseen = all<{ achievement_id: string }>('SELECT achievement_id FROM user_achievements WHERE profile_id = ? AND seen = 0', p.id).map((r) => ACHIEVEMENTS.find((a) => a.id === r.achievement_id)).filter(Boolean);
  run('UPDATE user_achievements SET seen = 1 WHERE profile_id = ?', p.id);
  const unread = one<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE profile_id = ? AND read = 0', p.id)!.n;
  const streak = streakInfo(p.id);
  const assignments = all<{ id: string; title: string; due_date: string }>("SELECT id, title, due_date FROM assignments WHERE profile_id = ? AND done = 0 ORDER BY COALESCE(due_date, '9999') LIMIT 3", p.id);
  res.json({
    profile: profileSummary(p), learningLevelLabel: levelLabel(p.learning_level, p.curriculum), schoolLabel: gradeLabel(p.school_grade, p.curriculum),
    xp, level: lv, streak, dailyGoalMin: p.daily_goal_min, todayMinutes: streak.todayMinutes,
    recommendations: recs, continueLearning, dailyChallenge: { solved: !!daily?.solved }, upcomingTests: tests, assignments,
    newAchievements: unseen, unreadNotifications: unread, aiAvailable: aiConfigured(),
    reviewDue: Object.values(mm).filter((m) => m.reviewDue).length,
  });
});

// ─────────────────────────────────────────── onboarding
learnRouter.post('/onboarding', (req, res) => {
  const p = P(req); const b = req.body ?? {};
  const school = num(b.schoolGrade, 'School level', { min: 0, max: 15, int: true, optional: true });
  const curriculum = oneOf(b.curriculum, 'Curriculum', CURRICULA.map((c) => c.id), 'us');
  const name = b.name ? str(b.name, 'Name', { max: 40 }) : p.name;
  const pick = (arr: unknown, allowed: string[], label: string) => strArray(arr, label, { maxItems: 20, maxLen: 80 }).filter((x) => allowed.includes(x) || x.startsWith('Other:'));
  const daily = num(b.dailyGoalMin, 'Daily goal', { min: 5, max: 180, int: true, optional: true }) ?? 20;
  run(`UPDATE profiles SET name = ?, school_grade = ?, curriculum = ?, current_course = ?, purposes = ?, enjoys = ?, styles = ?, goals = ?, daily_goal_min = ?, onboarded = 1, updated_at = datetime('now') WHERE id = ?`,
    name, school, curriculum, str(b.currentCourse, 'Current course', { optional: true, max: 80 }) || null,
    JSON.stringify(pick(b.purposes, ONBOARDING.purposes, 'purposes')), JSON.stringify(pick(b.enjoys, ONBOARDING.enjoys, 'enjoys')),
    JSON.stringify(pick(b.styles, ONBOARDING.styles, 'styles')), JSON.stringify(pick(b.goals, ONBOARDING.goals, 'goals')), daily, p.id);
  // Enroll in the matching core course so recommendations have a path.
  const g = school ?? 6;
  const courseId = g === 0 ? 'kindergarten' : g <= 3 ? 'grades-1-3' : g <= 6 ? 'grades-4-6' : g <= 8 ? 'grades-7-8' : g <= 12 ? 'grades-9-12' : 'calculus-1';
  run('INSERT OR IGNORE INTO enrollments (profile_id, course_id) VALUES (?, ?)', p.id, courseId);
  run('UPDATE profiles SET current_course = COALESCE(current_course, ?) WHERE id = ? AND current_course IS NULL', courseId, p.id);
  track('onboarding_complete', { band: g <= 2 ? 'early' : g <= 5 ? 'elementary' : g <= 12 ? 'secondary' : 'university' }, optOut(p));
  res.json({ profile: profileSummary(one<ProfileRow>('SELECT * FROM profiles WHERE id = ?', p.id)!), enrolledCourse: courseId });
});

// ─────────────────────────────────────────── adaptive placement
interface PlacementState { domains: { id: DomainId; theta: number; step: number; asked: number; correct: number; skills: string[] }[]; perDomain: number; index: number; current?: string; done: boolean; history: { domain: DomainId; skill: string; grade: number; correct: boolean }[] }
const savePlacement = (pid: string, st: PlacementState) => run(`INSERT INTO lesson_progress (profile_id, lesson_key, stage, status, data) VALUES (?, 'placement', 'placement', ?, ?)
  ON CONFLICT(profile_id, lesson_key) DO UPDATE SET data = excluded.data, status = excluded.status, updated_at = datetime('now')`, pid, st.done ? 'completed' : 'in_progress', JSON.stringify(st));
const loadPlacement = (pid: string) => json<PlacementState | null>(one<{ data: string }>("SELECT data FROM lesson_progress WHERE profile_id = ? AND lesson_key = 'placement'", pid)?.data, null);

function placementNext(p: ProfileRow, st: PlacementState) {
  const open = st.domains.filter((d) => d.asked < st.perDomain);
  if (!open.length) return null;
  const dom = open[st.index % open.length];
  const skills = SKILLS.filter((s) => s.domain === dom.id);
  const ranked = skills.map((s) => ({ s, score: Math.abs(s.grade - dom.theta) + (dom.skills.includes(s.id) ? 3 : 0) + Math.random() * 0.4 })).sort((a, b) => a.score - b.score);
  const skill = ranked[0].s;
  const early = (p.school_grade ?? 6) <= 2;
  const q = generateQuestion(skill.id, early ? 2 : 3);
  st.current = q.id;
  return { question: issueQuestion(p.id, q, 'placement'), domain: dom.id, domainName: DOMAINS[dom.id].name, progress: { asked: st.domains.reduce((s, d) => s + d.asked, 0), total: st.domains.length * st.perDomain } };
}

learnRouter.post('/placement/start', (req, res) => {
  const p = P(req);
  const sg = p.school_grade ?? 6; const uni = sg >= 13;
  const start = uni ? 12 : sg;
  const domains = (uni ? (['algebra', 'functions', 'trigonometry', 'calculus', 'statistics', 'probability', 'linear-algebra', 'discrete'] as DomainId[])
    : sg <= 2 ? (['number', 'geometry', 'puzzles', 'mental'] as DomainId[])
    : PLACEMENT_DOMAINS.filter((d) => SKILLS.some((s) => s.domain === d && s.grade <= sg + 1.5)));
  const st: PlacementState = { domains: domains.map((id) => ({ id, theta: Math.max(start, Math.min(...SKILLS.filter((s) => s.domain === id).map((s) => s.grade))), step: sg <= 2 ? 1 : 2, asked: 0, correct: 0, skills: [] })), perDomain: sg <= 2 ? 3 : domains.length > 8 ? 2 : 3, index: 0, done: false, history: [] };
  const next = placementNext(p, st);
  savePlacement(p.id, st);
  track('placement_started', {}, optOut(p));
  res.json({ ...next, intro: { domains: domains.map((d) => DOMAINS[d].name), total: st.domains.length * st.perDomain } });
});

learnRouter.post('/placement/answer', (req, res) => {
  const p = P(req);
  const st = loadPlacement(p.id);
  if (!st || st.done) throw bad('Start the placement check first.');
  const iq = loadIssued(p.id, str(req.body?.questionId, 'question', { max: 64 }));
  if (iq.id !== st.current) throw bad('That question is no longer active.');
  const skipped = req.body?.skip === true;
  const correct = !skipped && checkAnswer(iq.q, String(req.body?.response ?? '')).correct;
  const dom = st.domains.find((d) => d.id === SKILL_MAP[iq.q.skillId].domain)!;
  const skillGrade = SKILL_MAP[iq.q.skillId].grade;
  dom.asked++; if (correct) dom.correct++; dom.skills.push(iq.q.skillId);
  // Bisection-style ability update around the item's grade.
  if (correct) dom.theta = Math.max(dom.theta, skillGrade) + dom.step; else dom.theta = Math.min(dom.theta, skillGrade) - dom.step * 0.8;
  dom.step = Math.max(0.5, dom.step * 0.6);
  const grades = SKILLS.filter((s) => s.domain === dom.id).map((s) => s.grade);
  dom.theta = Math.max(Math.min(...grades) - 1.5, Math.min(Math.max(...grades) + 1, dom.theta));
  st.history.push({ domain: dom.id, skill: iq.q.skillId, grade: skillGrade, correct });
  run('UPDATE issued_questions SET attempts = 1, solved = ? WHERE id = ?', correct ? 1 : 0, iq.id);
  run('INSERT INTO question_attempts (profile_id, question_id, skill_id, difficulty, correct, mode) VALUES (?, ?, ?, ?, ?, ?)', p.id, iq.q.id, iq.q.skillId, iq.q.difficulty, correct ? 1 : 0, 'placement');
  recordActivity(p.id, 30, 1);
  st.index++;
  const next = placementNext(p, st);
  if (next) { savePlacement(p.id, st); return res.json({ correct, feedback: correct ? 'Nice!' : skipped ? 'No problem — that helps us find your level.' : 'Thanks — that helps us find the right starting point.', ...next }); }
  // Finished → estimate mastery & level
  st.done = true; savePlacement(p.id, st);
  const abilities: Partial<Record<DomainId, number>> = {};
  for (const d of st.domains) abilities[d.id] = Math.round(d.theta * 10) / 10;
  seedEstimatedMastery(p.id, abilities);
  run('UPDATE profiles SET placement_done = 1 WHERE id = ?', p.id);
  const xp = awardXp(p.id, 'placement_complete', 'Placement assessment');
  computeLearningLevel(p.id);
  const ach = checkAchievements(p.id);
  track('placement_completed', {}, optOut(p));
  res.json({ correct, done: true, xp, achievements: ach, result: placementResult(one<ProfileRow>('SELECT * FROM profiles WHERE id = ?', p.id)!) });
});

function placementResult(p: ProfileRow) {
  const mm = masteryMap(p.id);
  const lvl = computeLearningLevel(p.id);
  const sg = p.school_grade ?? Math.floor(lvl.overall ?? 6);
  const topics = topicMastery(mm, sg <= 12 ? Math.max(sg, 1) : 15);
  const doms = Object.entries(lvl.domains).map(([d, v]) => ({ domain: d as DomainId, name: DOMAINS[d as DomainId].name, icon: DOMAINS[d as DomainId].icon, level: v!, label: levelLabel(v, p.curriculum) }));
  const sorted = [...doms].sort((a, b) => b.level - a.level);
  const strengths = sorted.filter((d) => d.level >= sg + 0.3).slice(0, 3);
  const weaknesses = sorted.filter((d) => d.level < sg - 0.3).slice(-3).reverse();
  const weakDomains = new Set((weaknesses.length ? weaknesses : sorted.slice(-2)).map((d) => d.domain));
  const missing = SKILLS.filter((s) => weakDomains.has(s.domain) && s.grade <= sg && (mm[s.id]?.effective ?? 0) < 60).sort((a, b) => a.grade - b.grade).slice(0, 5).map((s) => ({ id: s.id, title: s.title, grade: gradeLabel(s.grade, p.curriculum) }));
  return {
    schoolLabel: gradeLabel(p.school_grade, p.curriculum), overall: lvl.overall, overallLabel: levelLabel(lvl.overall, p.curriculum),
    domains: doms, topics, strengths: (strengths.length ? strengths : sorted.slice(0, 2)), weaknesses: weaknesses.length ? weaknesses : sorted.slice(-2).reverse(), missingPrerequisites: missing,
    path: recommendations(p, 5),
  };
}
learnRouter.get('/placement/result', (req, res) => {
  const p = P(req);
  if (!p.placement_done) throw notFound('No placement result yet.');
  res.json({ result: placementResult(p) });
});

// ─────────────────────────────────────────── skill tree & mastery
learnRouter.get('/skills', (req, res) => {
  const p = P(req);
  const mm = masteryMap(p.id);
  const level = p.learning_level ?? p.school_grade ?? 5;
  const recs = new Set(recommendations(p, 6).map((r) => r.skillId));
  const nodes = SKILLS.map((s) => {
    const m = mm[s.id]; const eff = m?.effective ?? 0;
    const status = eff >= 80 ? 'completed' : recs.has(s.id) ? 'recommended' : (m && (m.attempts > 0 || eff > 0)) ? 'in_progress' : prereqsMet(s, mm, level) ? 'available' : 'locked';
    return { id: s.id, title: s.title, domain: s.domain, grade: s.grade, gradeLabel: gradeLabel(s.grade, p.curriculum), prereqs: s.prereqs, summary: s.summary, mastery: Math.round(eff), attempts: m?.attempts ?? 0, estimated: !!m?.estimated, reviewDue: !!m?.reviewDue, status };
  });
  res.json({ nodes, domains: Object.entries(DOMAINS).map(([id, d]) => ({ id, ...d })), domainLevels: domainLevels(mm) });
});

// ─────────────────────────────────────────── courses
function courseProgress(c: Course, p: ProfileRow, mm: ReturnType<typeof masteryMap>) {
  const done = new Set(all<{ lesson_key: string }>("SELECT lesson_key FROM lesson_progress WHERE profile_id = ? AND status = 'completed'", p.id).map((r) => r.lesson_key));
  const lessons = c.units.flatMap((u) => u.lessons);
  const isDone = (l: Course['units'][number]['lessons'][number]) => done.has(l.skillId && !l.generated ? l.skillId : `${c.id}:${l.id}`) || (!!l.skillId && (mm[l.skillId]?.effective ?? 0) >= 80 && !mm[l.skillId]?.estimated);
  const completed = lessons.filter(isDone).length;
  return { completed, total: lessons.length, percent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0, isDone };
}
const courseCard = (c: Course, prog: { percent: number; completed: number; total: number }) => ({ id: c.id, title: c.title, description: c.description, band: c.band, icon: c.icon ?? '📘', difficulty: c.difficulty, targetLevel: c.targetLevel, generatedBy: c.generatedBy, status: c.status, lessons: prog.total, completed: prog.completed, percent: prog.percent });

learnRouter.get('/courses', (req, res) => {
  const p = P(req); const mm = masteryMap(p.id);
  const enrolled = new Set(all<{ course_id: string }>('SELECT course_id FROM enrollments WHERE profile_id = ?', p.id).map((r) => r.course_id));
  const toCard = (c: Course) => ({ ...courseCard(c, courseProgress(c, p, mm)), enrolled: enrolled.has(c.id) });
  const mine = all<{ data: string; status: string }>('SELECT data, status FROM courses WHERE owner_profile_id = ? ORDER BY created_at DESC', p.id).map((r) => toCard({ ...json<Course>(r.data, null as unknown as Course), status: r.status as Course['status'] }));
  const community = all<{ data: string; owner_profile_id: string | null }>("SELECT data, owner_profile_id FROM courses WHERE status = 'approved' ORDER BY updated_at DESC LIMIT 30").filter((r) => r.owner_profile_id !== p.id).map((r) => toCard({ ...json<Course>(r.data, null as unknown as Course), status: 'approved' }));
  res.json({ core: CORE_COURSES.map(toCard), mine, community });
});

learnRouter.get('/courses/:id', (req, res) => {
  const p = P(req);
  const c = getCourse(req.params.id, p.id);
  if (!c) throw notFound('Course not found');
  const mm = masteryMap(p.id); const prog = courseProgress(c, p, mm);
  const enrolled = !!one('SELECT 1 FROM enrollments WHERE profile_id = ? AND course_id = ?', p.id, c.id);
  let nextLesson: string | null = null;
  const units = c.units.map((u) => ({ ...u, lessons: u.lessons.map((l) => {
    const done = prog.isDone(l); const skill = l.skillId ? SKILL_MAP[l.skillId] : undefined;
    const locked = !!skill && !done && !prereqsMet(skill, mm, (p.learning_level ?? p.school_grade ?? 5) + 1) && l.kind !== 'review';
    if (!done && !nextLesson) nextLesson = l.id;
    return { id: l.id, title: l.title, skillId: l.skillId, kind: l.kind ?? 'lesson', generated: !!l.generated, done, locked, mastery: l.skillId ? mm[l.skillId]?.effective ?? 0 : null, gradeLabel: skill ? gradeLabel(skill.grade, p.curriculum) : null, objective: l.generated?.objective ?? skill?.summary };
  }) }));
  if (enrolled) run("UPDATE enrollments SET last_opened = datetime('now') WHERE profile_id = ? AND course_id = ?", p.id, c.id);
  res.json({ course: { ...courseCard(c, prog), units, prerequisites: c.prerequisites.map((s) => ({ id: s, title: SKILL_MAP[s]?.title ?? s, mastery: mm[s]?.effective ?? 0 })), validation: (c as Course & { validation?: unknown }).validation, notes: (c as Course & { notes?: unknown }).notes, resources: c.resources }, enrolled, nextLesson });
});

learnRouter.post('/courses/:id/enroll', (req, res) => {
  const p = P(req);
  const c = getCourse(req.params.id, p.id);
  if (!c) throw notFound('Course not found');
  run('INSERT OR IGNORE INTO enrollments (profile_id, course_id) VALUES (?, ?)', p.id, c.id);
  run('UPDATE profiles SET current_course = ? WHERE id = ?', c.id, p.id);
  res.json({ ok: true });
});
learnRouter.delete('/courses/:id/enroll', (req, res) => {
  const p = P(req);
  run('DELETE FROM enrollments WHERE profile_id = ? AND course_id = ?', p.id, req.params.id);
  if (p.current_course === req.params.id) run('UPDATE profiles SET current_course = NULL WHERE id = ?', p.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── lessons
learnRouter.get('/lessons/:key', (req, res) => {
  const p = P(req);
  const key = req.params.key; const courseId = typeof req.query.course === 'string' ? req.query.course : null;
  const progress = one<{ stage: string; status: string; score: number | null; data: string }>('SELECT stage, status, score, data FROM lesson_progress WHERE profile_id = ? AND lesson_key = ?', p.id, courseId && !SKILL_MAP[key] ? `${courseId}:${key}` : key);
  const mm = masteryMap(p.id);
  if (SKILL_MAP[key]) {
    const s = SKILL_MAP[key];
    // Stable worked example per skill (seeded), at an approachable difficulty.
    const ex = generateQuestion(s.id, 2, makeRng(hashString(`example:${s.id}`)));
    return res.json({ lesson: { key, kind: 'skill', skill: { ...s, gradeLabel: gradeLabel(s.grade, p.curriculum), domainName: DOMAINS[s.domain].name }, example: { prompt: ex.prompt, steps: ex.steps, answer: ex.answer, unit: ex.unit, visual: ex.visual, explanation: ex.explanation }, prereqs: s.prereqs.map((id) => ({ id, title: SKILL_MAP[id].title, mastery: mm[id]?.effective ?? 0 })), mastery: mm[s.id] ?? null }, progress: progress ? { ...progress, data: json(progress.data, {}) } : null });
  }
  if (!courseId) throw notFound('Lesson not found');
  const c = getCourse(courseId, p.id);
  const l = c?.units.flatMap((u) => u.lessons).find((x) => x.id === key);
  if (!c || !l?.generated) throw notFound('Lesson not found');
  const g = l.generated;
  res.json({ lesson: { key, kind: 'generated', courseId, title: l.title, skill: { id: `gen:${c.id}:${l.id}`, title: l.title, summary: g.objective, learn: g.explanation, keyIdea: g.objective, realWorld: '', explainPrompt: g.explainPrompt, explainKeywords: g.explainKeywords, domainName: c.title, gradeLabel: c.band ?? '' }, example: { prompt: g.example.problem, steps: g.example.steps, answer: g.example.answer }, prereqs: [], mastery: null, practiceCount: g.practice.length, hasChallenge: !!g.challenge, aiGenerated: true }, progress: progress ? { ...progress, data: json(progress.data, {}) } : null });
});

learnRouter.post('/lessons/:key/progress', (req, res) => {
  const p = P(req);
  const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId : null;
  const key = courseId && !SKILL_MAP[req.params.key] ? `${courseId}:${req.params.key}` : req.params.key;
  const stage = oneOf(req.body?.stage, 'stage', ['learn', 'example', 'try', 'practice', 'challenge', 'explain', 'check', 'done'] as const);
  const complete = req.body?.complete === true;
  const score = num(req.body?.score, 'score', { min: 0, max: 100, optional: true });
  const prev = one<{ status: string }>('SELECT status FROM lesson_progress WHERE profile_id = ? AND lesson_key = ?', p.id, key);
  run(`INSERT INTO lesson_progress (profile_id, lesson_key, stage, status, score, completed_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, lesson_key) DO UPDATE SET stage = excluded.stage, status = CASE WHEN status = 'completed' THEN 'completed' ELSE excluded.status END,
       score = COALESCE(excluded.score, score), completed_at = COALESCE(completed_at, excluded.completed_at), updated_at = datetime('now')`,
  p.id, key, stage, complete ? 'completed' : 'in_progress', score, complete ? new Date().toISOString() : null);
  let xp = 0; let achievements: typeof ACHIEVEMENTS = [];
  const levelBefore = levelFromXp(totalXp(p.id)).level;
  if (complete && prev?.status !== 'completed') {
    xp += awardXp(p.id, 'lesson_complete', `Lesson: ${SKILL_MAP[req.params.key]?.title ?? req.params.key}`);
    if (score === 100) xp += awardXp(p.id, 'perfect_lesson', 'Perfect lesson');
    track('lesson_completed', { domain: SKILL_MAP[req.params.key]?.domain ?? 'custom' }, optOut(p));
    computeLearningLevel(p.id);
    achievements = checkAchievements(p.id);
  }
  recordActivity(p.id, 20);
  const levelAfter = levelFromXp(totalXp(p.id)).level;
  const next = complete ? recommendations(one<ProfileRow>('SELECT * FROM profiles WHERE id = ?', p.id)!, 1)[0] ?? null : null;
  res.json({ ok: true, xp, achievements, levelUp: levelAfter > levelBefore ? levelAfter : null, next });
});

learnRouter.post('/explain', async (req, res) => {
  const p = P(req);
  const skillId = str(req.body?.skillId, 'skill', { max: 120 });
  const text = str(req.body?.text, 'Explanation', { max: 3000 });
  let result;
  if (skillId.startsWith('gen:')) {
    const [, courseId, lessonId] = skillId.split(':');
    const l = getCourse(courseId, p.id)?.units.flatMap((u) => u.lessons).find((x) => x.id === lessonId);
    const kws = l?.generated?.explainKeywords ?? [];
    const matched = kws.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
    const score = Math.min(100, Math.round((matched.length / Math.max(2, kws.length)) * 75 + Math.min(25, text.split(/\s+/).length)));
    result = { score, feedback: score >= 70 ? 'Clear explanation!' : `Good start — try to mention: ${kws.filter((k) => !matched.includes(k)).slice(0, 2).join(', ')}.`, matched, missing: kws.filter((k) => !matched.includes(k)), source: 'builtin' as const };
  } else {
    if (!SKILL_MAP[skillId]) throw bad('Unknown skill');
    result = await evaluateExplanation(skillId, text, p);
    setExplainScore(p.id, skillId, result.score);
  }
  const xp = awardXp(p.id, 'explain', `Explained ${SKILL_MAP[skillId]?.title ?? 'a concept'}`);
  recordActivity(p.id, 60);
  const achievements = checkAchievements(p.id);
  res.json({ ...result, xp, achievements });
});

learnRouter.post('/confidence', (req, res) => {
  const p = P(req);
  const skillId = str(req.body?.skillId, 'skill', { max: 60 });
  if (!SKILL_MAP[skillId]) throw bad('Unknown skill');
  setConfidence(p.id, skillId, num(req.body?.value, 'confidence', { min: 0, max: 3, int: true })!);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── daily challenge
learnRouter.get('/daily', (req, res) => {
  const p = P(req); const day = today();
  const existing = one<{ question_id: string; solved: number }>('SELECT question_id, solved FROM daily_challenges WHERE profile_id = ? AND day = ?', p.id, day);
  if (existing) {
    const iq = one<{ payload: string }>('SELECT payload FROM issued_questions WHERE id = ?', existing.question_id);
    if (iq) { const q = json<Question>(iq.payload, null as unknown as Question); return res.json({ day, solved: !!existing.solved, question: toPublic(q), solution: existing.solved ? { answer: q.answer, steps: q.steps, explanation: q.explanation } : null }); }
  }
  const recent = all<{ solved: number }>('SELECT solved FROM daily_challenges WHERE profile_id = ? ORDER BY day DESC LIMIT 3', p.id);
  const d = recent.length === 3 && recent.every((r) => r.solved) ? 5 : recent.filter((r) => !r.solved).length >= 2 ? 3 : 4;
  const rng = makeRng(hashString(`${p.id}:${day}`));
  const level = p.learning_level ?? p.school_grade ?? 5;
  const pool = SKILLS.filter((s) => s.grade <= level + 1 && s.grade >= level - 1.5 && !s.calculator && s.domain !== 'mental');
  const skill = (pool.length ? pool : SKILLS.filter((s) => s.grade <= Math.max(1, level)))[Math.floor(rng() * Math.max(1, pool.length))] ?? SKILLS[0];
  const q = generateQuestion(skill.id, d, rng);
  issueQuestion(p.id, q, 'daily');
  run('INSERT OR REPLACE INTO daily_challenges (profile_id, day, question_id, solved) VALUES (?, ?, ?, 0)', p.id, day, q.id);
  res.json({ day, solved: false, question: toPublic(q), solution: null, tagline: 'Can you solve this without a calculator?' });
});

// ─────────────────────────────────────────── progress & activity
learnRouter.get('/progress', (req, res) => {
  const p = P(req);
  const xp = totalXp(p.id); const lv = levelFromXp(xp);
  const mm = masteryMap(p.id); const lvl = computeLearningLevel(p.id);
  const unlocked = new Map(all<{ achievement_id: string; unlocked_at: string }>('SELECT achievement_id, unlocked_at FROM user_achievements WHERE profile_id = ?', p.id).map((r) => [r.achievement_id, r.unlocked_at]));
  const xpDays = all<{ day: string; xp: number }>("SELECT date(created_at) day, SUM(amount) xp FROM xp_transactions WHERE profile_id = ? AND created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day", p.id);
  const heat = all<{ day: string; seconds: number; questions: number }>("SELECT day, seconds, questions FROM activity_days WHERE profile_id = ? AND day >= date('now','-83 days')", p.id);
  const totals = one<{ n: number; c: number }>('SELECT COUNT(*) n, COALESCE(SUM(correct),0) c FROM question_attempts WHERE profile_id = ?', p.id)!;
  const lessons = one<{ n: number }>("SELECT COUNT(*) n FROM lesson_progress WHERE profile_id = ? AND status = 'completed' AND lesson_key != 'placement'", p.id)!.n;
  const recentXp = all('SELECT amount, reason, created_at FROM xp_transactions WHERE profile_id = ? ORDER BY id DESC LIMIT 15', p.id);
  res.json({
    xp, level: lv, unlocks: UNLOCKS.map((u) => ({ ...u, unlocked: lv.level >= u.level })), themes: Object.entries(ACCENT_THEMES).map(([id, t]) => ({ id, ...t, unlocked: lv.level >= t.minLevel })),
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlocked: unlocked.has(a.id), unlockedAt: unlocked.get(a.id) ?? null })),
    streak: streakInfo(p.id), learningLevel: { overall: lvl.overall, label: levelLabel(lvl.overall, p.curriculum), domains: Object.entries(lvl.domains).map(([d, v]) => ({ domain: d, name: DOMAINS[d as DomainId].name, icon: DOMAINS[d as DomainId].icon, level: v, label: levelLabel(v, p.curriculum) })) },
    topics: topicMastery(mm, p.school_grade != null && p.school_grade <= 12 ? Math.max(p.school_grade, Math.ceil(lvl.overall ?? 0)) : 15),
    xpDays, heat, totals: { questions: totals.n, correct: totals.c, lessons, accuracy: totals.n ? Math.round((totals.c / totals.n) * 100) : null }, recentXp,
    skills: Object.values(mm).filter((m) => !m.estimated || m.attempts > 0).map((m) => ({ ...m, title: SKILL_MAP[m.skillId]?.title, domain: SKILL_MAP[m.skillId]?.domain })).sort((a, b) => b.effective - a.effective),
  });
});

learnRouter.post('/activity', (req, res) => {
  const p = P(req);
  recordActivity(p.id, Math.min(120, num(req.body?.seconds, 'seconds', { min: 0, max: 600 }) ?? 0));
  res.json({ ok: true, achievements: checkAchievements(p.id) });
});

// ─────────────────────────────────────────── preferences
const PREF_KEYS: Record<string, 'bool' | 'string' | 'object'> = { learningMode: 'bool', analyticsOptOut: 'bool', saveTutorHistory: 'bool', voiceReplies: 'bool', highContrast: 'bool', reducedMotion: 'bool', textSize: 'string', theme: 'string', accent: 'string', notifications: 'object', browserNotifications: 'bool' };
learnRouter.patch('/preferences', (req, res) => {
  const p = P(req); const cur = prefsOf(p);
  for (const [k, v] of Object.entries(req.body ?? {})) {
    const t = PREF_KEYS[k];
    if (!t) continue;
    if (t === 'bool' && typeof v === 'boolean') cur[k] = v;
    if (t === 'string' && typeof v === 'string' && v.length < 30) cur[k] = v;
    if (t === 'object' && v && typeof v === 'object') cur[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === 'boolean').slice(0, 20));
  }
  if (typeof cur.accent === 'string' && ACCENT_THEMES[cur.accent] && levelFromXp(totalXp(p.id)).level < ACCENT_THEMES[cur.accent].minLevel) throw bad('That theme unlocks at a higher level.');
  run("UPDATE profiles SET preferences = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(cur), p.id);
  res.json({ preferences: cur });
});
learnRouter.get('/preferences', (req, res) => res.json({ preferences: prefsOf(P(req)) }));

// ─────────────────────────────────────────── notifications
learnRouter.get('/notifications', (req, res) => {
  const p = P(req); notificationSweep(p);
  res.json({ notifications: all('SELECT id, kind, title, body, link, read, created_at FROM notifications WHERE profile_id = ? ORDER BY created_at DESC LIMIT 50', p.id) });
});
learnRouter.post('/notifications/read', (req, res) => {
  const p = P(req);
  if (req.body?.id) run('UPDATE notifications SET read = 1 WHERE id = ? AND profile_id = ?', String(req.body.id), p.id);
  else run('UPDATE notifications SET read = 1 WHERE profile_id = ?', p.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── search
learnRouter.get('/search', (req, res) => {
  const p = P(req);
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return res.json({ results: [] });
  const terms = q.split(/\s+/);
  const score = (text: string, boost = 1) => terms.reduce((s, t) => s + (text.toLowerCase().includes(t) ? boost : 0), 0);
  type R = { type: string; id: string; title: string; subtitle: string; link: string; score: number };
  const results: R[] = [];
  for (const s of SKILLS) {
    const sc = score(s.title, 5) + score(s.tags.join(' '), 3) + score(s.summary, 1) + score(DOMAINS[s.domain].name, 1);
    if (sc > 0) results.push({ type: 'Lesson', id: s.id, title: s.title, subtitle: `${DOMAINS[s.domain].name} · ${gradeLabel(s.grade, p.curriculum)}`, link: `/lesson/${s.id}`, score: sc + (s.title.toLowerCase().startsWith(q) ? 5 : 0) });
  }
  for (const c of CORE_COURSES) { const sc = score(c.title, 5) + score(c.description, 1); if (sc > 0) results.push({ type: 'Course', id: c.id, title: c.title, subtitle: c.band ?? '', link: `/learn/${c.id}`, score: sc }); }
  for (const r of all<{ id: string; data: string; status: string; owner_profile_id: string }>("SELECT id, data, status, owner_profile_id FROM courses WHERE owner_profile_id = ? OR status = 'approved'", p.id)) {
    const c = json<Course>(r.data, null as unknown as Course); if (!c) continue;
    const sc = score(c.title, 5) + score(c.description, 1);
    if (sc > 0) results.push({ type: r.owner_profile_id === p.id ? 'My course' : 'Community course', id: r.id, title: c.title, subtitle: c.description.slice(0, 80), link: `/learn/${r.id}`, score: sc });
    for (const u of c.units) for (const l of u.lessons) if (l.generated && score(l.title, 4) > 0) results.push({ type: 'Lesson', id: `${r.id}:${l.id}`, title: l.title, subtitle: c.title, link: `/learn/${r.id}/lesson/${l.id}`, score: score(l.title, 4) });
  }
  for (const r of all<{ id: string; title: string; source: string; url: string; skill_ids: string }>('SELECT id, title, source, url, skill_ids FROM resources WHERE approved = 1')) {
    const sc = score(r.title, 3) + score(json<string[]>(r.skill_ids, []).map((s) => SKILL_MAP[s]?.title ?? '').join(' '), 1);
    if (sc > 0) results.push({ type: 'Resource', id: r.id, title: r.title, subtitle: `External · ${r.source}`, link: r.url, score: sc });
  }
  // Questions: offer a practice set for matching skills
  for (const s of SKILLS) if (score(s.title, 5) + score(s.tags.join(' '), 3) >= 3) results.push({ type: 'Practice', id: `practice:${s.id}`, title: `Practice: ${s.title}`, subtitle: 'Adaptive questions', link: `/practice/session?skill=${s.id}&mode=practice`, score: 2 });
  track('search', {}, optOut(p));
  res.json({ results: results.sort((a, b) => b.score - a.score).slice(0, 20) });
});

// ─────────────────────────────────────────── resources (curated; external links are labeled)
learnRouter.get('/resources', (req, res) => {
  const skill = typeof req.query.skill === 'string' ? req.query.skill : null;
  const rows = all<{ id: string; title: string; url: string; source: string; kind: string; skill_ids: string; domain: string | null; difficulty: string | null; description: string | null }>('SELECT * FROM resources WHERE approved = 1 ORDER BY source, title');
  const list = rows.map((r) => ({ ...r, skill_ids: json<string[]>(r.skill_ids, []), external: true }));
  if (!skill) return res.json({ resources: list });
  const s = SKILL_MAP[skill];
  const matched = list.filter((r) => r.skill_ids.includes(skill)).concat(list.filter((r) => !r.skill_ids.includes(skill) && s && r.domain === s.domain)).slice(0, 6)
    .map((r) => ({ ...r, why: r.skill_ids.includes(skill) ? `Covers ${s?.title ?? 'this topic'} directly.` : `A broader ${DOMAINS[s!.domain].name} resource that includes this topic.` }));
  res.json({ resources: matched });
});

learnRouter.post('/flag', (req, res) => {
  const p = P(req);
  const kind = oneOf(req.body?.kind, 'kind', ['question', 'explanation', 'course', 'tutor', 'resource', 'other'] as const);
  const reason = str(req.body?.reason, 'Reason', { max: 500 });
  const ref = str(req.body?.ref, 'ref', { optional: true, max: 120 });
  let snapshot: string | null = null;
  if (kind === 'question' && ref) { const iq = one<{ payload: string }>('SELECT payload FROM issued_questions WHERE id = ? AND profile_id = ?', ref, p.id); snapshot = iq?.payload ?? null; }
  run('INSERT INTO flagged_content (id, profile_id, kind, ref, snapshot, reason) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), p.id, kind, ref || null, snapshot, reason);
  res.json({ ok: true });
});

