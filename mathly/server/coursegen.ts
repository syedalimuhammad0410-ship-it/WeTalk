// Custom course engine: builds a personalized learning path for any requested topic.
// 1) Deterministic planner maps the topic onto the skill graph and inserts prerequisite reviews.
// 2) When an AI provider is configured, Claude designs the course and writes lessons for topics the
//    curriculum doesn't cover; every generated question is mathematically verified before use.
import { randomUUID } from 'node:crypto';
import type { Course, CourseUnit, GeneratedLesson, Question, Verify } from '../shared/types.ts';
import { SKILLS, SKILL_MAP } from '../shared/skills.ts';
import { DOMAINS, TOPIC_MAP, gradeLabel } from '../shared/curriculum.ts';
import { aiConfigured, aiJSON, S } from './ai/provider.ts';
import { sanitizeQuestion, verifyQuestion } from './engine/check.ts';
import type { MasteryView } from './learning.ts';
import type { ProfileRow } from './auth.ts';

export const normalizeTopic = (t: string) => t.toLowerCase()
  .replace(/^(i\s+(want|would like|wanna|need)\s+to\s+(learn|study|understand|know)( about)?|teach me( about)?|how (do|does|to))\s+/i, '')
  .replace(/^(the\s+)?(math|maths|mathematics)\s+(used\s+in|behind|of|for)\s+/i, '').replace(/[^a-z0-9\s+\-]/g, ' ').replace(/\s+/g, ' ').trim();

export const LEVELS = ['Beginner', 'School', 'Advanced', 'University', 'Expert'] as const;
export const STYLES = ['Visual', 'Practice', 'AI tutor', 'Videos', 'Articles', 'Projects', 'Real-world examples', 'Tests'] as const;

export interface BuildRequest { topic: string; reason?: string; level?: string; style?: string }
export interface BuildResult { course: Course | null; matched: boolean; message: string; suggestions: { id: string; title: string }[] }

export function matchSkills(topic: string): { title: string; description: string; skills: string[]; matched: boolean } {
  const t = normalizeTopic(topic);
  const hits = TOPIC_MAP.map((e) => ({ e, s: e.keywords.reduce((acc, k) => acc + (t.includes(k) ? k.length : 0), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (hits.length) {
    const skills = [...new Set(hits.slice(0, 2).flatMap((h) => h.e.skills))];
    return { title: hits[0].e.title, description: hits[0].e.description, skills, matched: true };
  }
  const words = t.split(' ').filter((w) => w.length > 3);
  const scored = SKILLS.map((s) => ({ s, sc: words.reduce((acc, w) => acc + (s.title.toLowerCase().includes(w) ? 3 : 0) + (s.tags.some((tg) => tg.includes(w)) ? 2 : 0), 0) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc);
  if (scored.length) return { title: topic.replace(/^i want to learn\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()), description: `A personalized path through ${scored.slice(0, 3).map((x) => x.s.title).join(', ')}.`, skills: scored.slice(0, 8).map((x) => x.s.id), matched: true };
  return { title: topic, description: '', skills: [], matched: false };
}

/** Recursively collect prerequisites, sorted so every prerequisite comes first. */
function closure(targets: string[]) {
  const seen = new Set<string>(); const order: string[] = [];
  const visit = (id: string) => { if (seen.has(id) || !SKILL_MAP[id]) return; seen.add(id); SKILL_MAP[id].prereqs.forEach(visit); order.push(id); };
  targets.forEach(visit);
  return order;
}

function planUnits(targets: string[], mm: Record<string, MasteryView>, level: number, uptoLevel: number) {
  const all = closure(targets);
  const targetSet = new Set(targets);
  const review: string[] = []; const mastered: string[] = []; const core: string[] = [];
  for (const id of all) {
    const s = SKILL_MAP[id]; const m = mm[id]; const eff = m?.effective ?? null;
    if (targetSet.has(id)) { if (eff !== null && eff >= 85 && !m?.estimated) mastered.push(id); else core.push(id); continue; }
    if (eff !== null && eff >= 60) { mastered.push(id); continue; }
    // Prerequisite with weak or unknown mastery that is near the learner's level → mini review course.
    if ((eff !== null && eff < 60) || (eff === null && s.grade >= level - 2 && s.grade <= uptoLevel)) review.push(id);
    else mastered.push(id);
  }
  const units: CourseUnit[] = [];
  if (review.length) units.push({ id: 'prereq-review', title: 'Prerequisite review', description: 'A short refresher on the foundations this course builds on.', lessons: review.slice(-6).map((id) => ({ id, title: SKILL_MAP[id].title, skillId: id, kind: 'review' as const })) });
  // Group core lessons into units by domain in order of first appearance, ≤5 lessons each.
  const groups: { domain: string; ids: string[] }[] = [];
  for (const id of core) {
    const d = SKILL_MAP[id].domain; const last = groups[groups.length - 1];
    if (last && last.domain === d && last.ids.length < 5) last.ids.push(id); else groups.push({ domain: d, ids: [id] });
  }
  groups.forEach((g, i) => units.push({ id: `u${i + 1}`, title: `${DOMAINS[g.domain as keyof typeof DOMAINS].name}${groups.filter((x) => x.domain === g.domain).length > 1 ? ` ${groups.filter((x, j) => x.domain === g.domain && j <= i).length}` : ''}`, lessons: g.ids.map((id) => ({ id, title: SKILL_MAP[id].title, skillId: id, kind: 'lesson' as const })) }));
  if (core.length >= 3) units.push({ id: 'checkpoint', title: 'Mastery checkpoint', description: 'Mixed review of everything in this path.', lessons: core.slice(-3).map((id) => ({ id: `check-${id}`, title: `Checkpoint: ${SKILL_MAP[id].title}`, skillId: id, kind: 'checkpoint' as const })) });
  return { units, review, mastered, core };
}

// ─────────────────────────── AI course design (validated)
const QUESTION_SCHEMA = S.obj({
  prompt: S.str(), answerType: S.enm(['number', 'fraction', 'expression', 'set', 'choice', 'text']), answer: S.str('Canonical answer. Numbers only for number type (no units).'),
  choices: S.arr(S.str(), 'Only for choice type; otherwise empty'), unit: S.str('Unit label or empty'), hints: S.arr(S.str(), 'Exactly 3 progressive hints'),
  steps: S.arr(S.str(), 'Worked solution steps prefixed with UNDERSTAND:, PLAN:, SOLVE:, CHECK:'), explanation: S.str(), difficulty: S.int('1-5'),
  verify: S.obj({ kind: S.enm(['numeric', 'equation', 'roots', 'derivative', 'antiderivative', 'equivalent', 'choice', 'none']), expr: S.str('mathjs expression whose value equals the answer (numeric/equivalent/roots)'), eq: S.str('equation like 3*x+5=20 (equation kind)'), variable: S.str('variable name or empty'), f: S.str('function for derivative/antiderivative kinds') }),
});
const COURSE_SCHEMA = S.obj({
  title: S.str(), description: S.str(), difficulty: S.enm(['Beginner', 'Intermediate', 'Advanced', 'University', 'Expert']), targetLevel: S.num('internal grade number 0-15'),
  objectives: S.arr(S.str()), notes: S.str('One paragraph explaining how the path was designed for this learner'),
  units: S.arr(S.obj({
    title: S.str(), description: S.str(),
    lessons: S.arr(S.obj({
      title: S.str(), skillId: S.str('An id from the provided skill list when one fits, else empty string'), objective: S.str(),
      explanation: S.arr(S.str(), 'For new lessons: 2-4 short teaching paragraphs. Empty when skillId is set.'),
      example: S.obj({ problem: S.str(), steps: S.arr(S.str()), answer: S.str() }),
      practice: S.arr(QUESTION_SCHEMA, 'For new lessons: 4 practice questions. Empty when skillId is set.'),
      explainPrompt: S.str(), explainKeywords: S.arr(S.str()),
    })),
  })),
});

interface AiQuestion { prompt: string; answerType: Question['answerType']; answer: string; choices: string[]; unit: string; hints: string[]; steps: string[]; explanation: string; difficulty: number; verify: { kind: string; expr: string; eq: string; variable: string; f: string } }
interface AiCourse { title: string; description: string; difficulty: string; targetLevel: number; objectives: string[]; notes: string; units: { title: string; description: string; lessons: { title: string; skillId: string; objective: string; explanation: string[]; example: { problem: string; steps: string[]; answer: string }; practice: AiQuestion[]; explainPrompt: string; explainKeywords: string[] }[] }[] }

function toVerify(v: AiQuestion['verify']): Verify {
  switch (v.kind) {
    case 'numeric': return { kind: 'numeric', expr: v.expr };
    case 'equation': return { kind: 'equation', eq: v.eq, variable: v.variable || 'x' };
    case 'roots': return { kind: 'roots', expr: v.expr, variable: v.variable || 'x' };
    case 'derivative': return { kind: 'derivative', f: v.f, variable: v.variable || 'x' };
    case 'antiderivative': return { kind: 'antiderivative', f: v.f, variable: v.variable || 'x' };
    case 'equivalent': return { kind: 'equivalent', expr: v.expr, vars: v.variable ? [v.variable] : [] };
    case 'choice': return { kind: 'choice' };
    default: return { kind: 'none', reason: 'conceptual (AI-generated, not machine-verifiable)' };
  }
}

export function validateAiQuestion(q: AiQuestion, skillId: string, seen: Set<string>): { question?: Question; reason?: string } {
  const key = q.prompt.trim().toLowerCase().replace(/\s+/g, ' ');
  if (seen.has(key)) return { reason: 'duplicate question' };
  const question: Question = sanitizeQuestion({
    id: randomUUID(), skillId, prompt: q.prompt, answerType: q.answerType, answer: q.answer, choices: q.answerType === 'choice' ? q.choices : undefined, unit: q.unit || undefined,
    variable: q.verify.variable || undefined, hints: q.hints.slice(0, 3), steps: q.steps, explanation: q.explanation, difficulty: Math.max(1, Math.min(5, Math.round(q.difficulty || 2))),
    verify: toVerify(q.verify), source: 'ai', mistakes: [],
  });
  // Non-verifiable free-text answers are rejected: we never show unverified answer keys to students.
  if (question.verify.kind === 'none' && question.answerType !== 'choice') return { reason: 'answer could not be machine-verified' };
  const v = verifyQuestion(question);
  if (!v.ok) return { reason: v.reason };
  seen.add(key);
  return { question };
}

export async function buildCourse(p: ProfileRow, mm: Record<string, MasteryView>, req: BuildRequest): Promise<BuildResult> {
  const level = p.learning_level ?? p.school_grade ?? 6;
  const want = req.level === 'Beginner' ? Math.max(0, level - 1) : req.level === 'University' || req.level === 'Expert' ? 15 : req.level === 'Advanced' ? 13 : 12;
  const match = matchSkills(req.topic);
  const base: Omit<Course, 'units' | 'title' | 'description'> = {
    id: randomUUID(), difficulty: req.level ?? 'School', targetLevel: Math.max(...match.skills.map((s) => SKILL_MAP[s].grade), level), prerequisites: [], resources: [],
    masteryRules: { lessonPass: 70, unitPass: 75 }, generatedBy: 'planner', status: 'personal',
  };
  let filtered = match.skills.filter((s) => SKILL_MAP[s].grade <= want + 1);
  if (!filtered.length) filtered = match.skills;

  if (aiConfigured()) {
    try {
      const skillList = SKILLS.map((s) => `${s.id}: ${s.title} (${DOMAINS[s.domain].name}, ${gradeLabel(s.grade)})`).join('\n');
      const masterySummary = Object.values(mm).filter((m) => m.effective > 0).map((m) => `${m.skillId}=${m.effective}%`).join(', ');
      const ai = await aiJSON<AiCourse>({
        system: `You are an expert mathematics curriculum designer for Mathly. Design rigorous, well-sequenced learning paths. Prefer existing skills (by id) whenever one fits; only write new lessons for concepts the list doesn't cover. Every new lesson must teach with the UNDERSTAND → PLAN → SOLVE → CHECK → COMMUNICATE framework. Practice questions must have short, exact, machine-checkable answers and a verify block that a math engine (mathjs) can evaluate; prefer numeric answers. Never invent external resources. Write age-appropriately for the learner.`,
        messages: [{ role: 'user', content: `Learner: school level ${gradeLabel(p.school_grade, p.curriculum)}, learning level ${level.toFixed(1)}.\nKnown mastery: ${masterySummary || 'none yet'}.\nRequested topic: "${req.topic}"\nWhy: ${req.reason || 'not given'}\nDesired level: ${req.level || 'School'}\nPreferred style: ${req.style || 'not given'}\nPlanner suggestion (existing skills): ${filtered.join(', ') || 'none'}\n\nAvailable skills (id: title):\n${skillList}\n\nDesign a course with 3-7 units and 2-5 lessons per unit. Do not include prerequisite review units — the system adds those automatically.` }],
        schema: COURSE_SCHEMA, maxTokens: 32000, effort: 'medium',
      });
      const seen = new Set<string>(); let checked = 0, passed = 0; const rejected: string[] = [];
      const units: CourseUnit[] = ai.units.map((u, ui) => ({
        id: `u${ui + 1}`, title: u.title, description: u.description,
        lessons: u.lessons.map((l, li) => {
          const id = `l${ui + 1}-${li + 1}`;
          if (l.skillId && SKILL_MAP[l.skillId]) return { id: l.skillId, title: l.title || SKILL_MAP[l.skillId].title, skillId: l.skillId, kind: 'lesson' as const };
          const practice: Question[] = [];
          for (const q of l.practice) { checked++; const r = validateAiQuestion(q, `gen:${base.id}:${id}`, seen); if (r.question) { practice.push(r.question); passed++; } else rejected.push(`${l.title}: ${r.reason}`); }
          const gen: GeneratedLesson = { objective: l.objective, explanation: l.explanation, example: l.example, practice: practice.slice(0, 5), challenge: practice.find((q) => q.difficulty >= 4), explainPrompt: l.explainPrompt, explainKeywords: l.explainKeywords.slice(0, 6) };
          return { id, title: l.title, generated: gen, kind: 'lesson' as const };
        }).filter((l) => !('generated' in l) || (l.generated && l.generated.practice.length >= 1)),
      })).filter((u) => u.lessons.length);
      if (units.length) {
        const usedSkills = units.flatMap((u) => u.lessons).map((l) => l.skillId).filter(Boolean) as string[];
        const plan = planUnits(usedSkills, mm, level, want);
        if (plan.units[0]?.id === 'prereq-review') units.unshift(plan.units[0]);
        const course: Course & { validation: unknown; notes: string; objectives: string[] } = {
          ...base, generatedBy: 'ai', title: ai.title, description: ai.description, difficulty: ai.difficulty, targetLevel: ai.targetLevel || base.targetLevel,
          prerequisites: plan.review, units, validation: { checked, passed, rejected: rejected.slice(0, 20) }, notes: ai.notes, objectives: ai.objectives,
        };
        return { course, matched: true, message: match.matched ? 'Here is your personalized learning path.' : 'We don’t have this course yet — so we built a learning path for you.', suggestions: [] };
      }
    } catch (e) {
      console.warn('[coursegen] AI course design failed, using planner:', (e as Error).message);
    }
  }

  if (!match.matched) {
    const words = normalizeTopic(req.topic).split(' ');
    const sugg = SKILLS.filter((s) => words.some((w) => w.length > 2 && (s.domain.includes(w) || s.summary.toLowerCase().includes(w)))).slice(0, 5);
    return { course: null, matched: false, message: aiConfigured() ? 'We couldn’t build a path for that topic right now. Your request has been saved — please try again in a moment.' : 'We don’t have this topic in the curriculum yet, and the AI course builder isn’t connected on this server. Your request has been saved so it can be added.', suggestions: sugg.map((s) => ({ id: s.id, title: s.title })) };
  }
  const plan = planUnits(filtered, mm, level, want);
  const course: Course & { notes: string } = {
    ...base, title: `${match.title} — Learning Path`, description: match.description, prerequisites: plan.review, units: plan.units,
    notes: `Built from ${plan.core.length} core lessons${plan.review.length ? ` plus a short review of ${plan.review.length} prerequisite${plan.review.length > 1 ? 's' : ''} you haven’t mastered yet` : ''}.${plan.mastered.length ? ` Skipped ${plan.mastered.length} prerequisite${plan.mastered.length > 1 ? 's' : ''} you already know.` : ''}`,
  };
  return { course, matched: true, message: 'Here is your personalized learning path.', suggestions: [] };
}
