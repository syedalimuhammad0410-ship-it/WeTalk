// The Math Tutor: Claude-powered when configured, with a deterministic built-in tutor otherwise.
// Both follow the same pedagogy: teach, ask, hint — don't just hand over answers.
import type { BetaMessageParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Question } from '../../shared/types.ts';
import { SKILLS, SKILL_MAP } from '../../shared/skills.ts';
import { DOMAINS, ageBandFor, gradeLabel, levelLabel } from '../../shared/curriculum.ts';
import { aiConfigured, aiText, AIUnavailable } from './provider.ts';
import { checkAnswer, safeNumeric } from '../engine/check.ts';
import { analyzeProblem, extractEquation } from '../engine/solver.ts';
import { generateQuestion, toPublic } from '../engine/index.ts';
import type { MasteryView } from '../learning.ts';
import type { ProfileRow } from '../auth.ts';
import { json } from '../db.ts';

export interface TutorContext {
  question?: Question | null;       // the problem currently on screen (server-side copy incl. answer)
  studentAnswer?: string;
  skillId?: string;
  helpLevel?: number;               // 1..6 (anti-cheating ladder)
  lessonStage?: string;
  pendingQuiz?: Question | null;    // a question the tutor asked in chat
  homework?: string;                // homework problem text
}
export interface TutorTurn { role: 'user' | 'assistant'; content: string }
export interface TutorResult { reply: string; source: 'ai' | 'builtin'; quiz?: ReturnType<typeof toPublic>; quizFull?: Question; clearQuiz?: boolean; example?: { prompt: string; steps: string[]; answer: string } }

const HELP_LEVELS = [
  'Level 1 — ask what the student thinks; do not give hints yet.',
  'Level 2 — give one small hint only.',
  'Level 3 — explain the relevant concept, without solving this problem.',
  'Level 4 — walk through ONLY the next step.',
  'Level 5 — show a similar worked example with different numbers.',
  'Level 6 — the student explicitly asked for the full solution; you may show it step by step.',
];

export function buildSystemPrompt(p: ProfileRow, mm: Record<string, MasteryView>, ctx: TutorContext, recentMistakes: string[]) {
  const band = ageBandFor(p.school_grade);
  const prefs = json<{ learningMode?: boolean }>(p.preferences, {});
  const learningMode = prefs.learningMode !== false;
  const strong = Object.values(mm).filter((m) => m.effective >= 80 && !m.estimated).slice(0, 6).map((m) => SKILL_MAP[m.skillId]?.title).filter(Boolean);
  const weak = Object.values(mm).filter((m) => m.attempts > 0 && m.effective < 50).slice(0, 6).map((m) => SKILL_MAP[m.skillId]?.title).filter(Boolean);
  const voice = band === 'early' ? 'Use very short sentences and simple words a 5–7 year old understands. Be warm and playful.'
    : band === 'elementary' ? 'Use friendly, simple language for an 8–11 year old. Short paragraphs.'
    : band === 'university' ? 'Write like a clear, rigorous university tutor. Use precise terminology; notation is welcome.'
    : 'Use clear, encouraging language for a teenager. Be concise.';
  const q = ctx.question ?? ctx.pendingQuiz;
  return `You are Mathly's math tutor — patient, encouraging and precise. Product philosophy: "Don't just get the answer. Learn how to think."

LEARNER
- Name: ${p.name}; school level: ${gradeLabel(p.school_grade, p.curriculum)}; current learning level: ${levelLabel(p.learning_level, p.curriculum)}.
- Prefers: ${json<string[]>(p.styles, []).join(', ') || 'not specified'}. Enjoys: ${json<string[]>(p.enjoys, []).join(', ') || 'not specified'}.
- Strong skills: ${strong.join(', ') || 'unknown yet'}. Still building: ${weak.join(', ') || 'unknown yet'}.
- Recent mistake patterns: ${recentMistakes.join('; ') || 'none recorded'}.
${ctx.skillId && SKILL_MAP[ctx.skillId] ? `- Current lesson/skill: ${SKILL_MAP[ctx.skillId].title} (${DOMAINS[SKILL_MAP[ctx.skillId].domain].name}). Key idea: ${SKILL_MAP[ctx.skillId].keyIdea}` : ''}
${q ? `\nCURRENT PROBLEM ON SCREEN\n${q.prompt}\nCorrect answer (CONFIDENTIAL — ${learningMode && (ctx.helpLevel ?? 1) < 6 ? 'do NOT reveal it or state it indirectly' : 'you may reveal it if asked'}): ${q.answer}\nWorked solution for your reference: ${q.steps.join(' | ')}` : ''}
${ctx.studentAnswer ? `Student's latest answer: ${ctx.studentAnswer}` : ''}
${ctx.homework ? `\nHOMEWORK PROBLEM\n${ctx.homework}` : ''}
${ctx.helpLevel ? `\nHELP LEVEL: ${HELP_LEVELS[Math.max(0, Math.min(5, ctx.helpLevel - 1))]}` : ''}

HOW TO TEACH
- ${learningMode ? 'Learning Mode is ON: guide with questions and hints; never give the final answer to the current problem unless the help level is 6 or the student explicitly asks to see the full solution for review.' : 'Learning Mode is OFF: you may show full solutions, but still explain the reasoning.'}
- Use the framework UNDERSTAND → PLAN → SOLVE → CHECK → COMMUNICATE when working through problems.
- Ask one Socratic question at a time. Keep replies short (under ~120 words) unless asked for depth.
- Never shame. Instead of "Wrong", say things like "You're close — let's look at the second step." Never call a student stupid or bad at math.
- If unsure, say so. Do not invent facts, sources, or links. If you mention an outside resource, label it clearly as external and only name well-known sources.
- ALWAYS use the "calculate" tool for any arithmetic you state, and "check_solution" before telling a student an equation answer is right or wrong. Do not rely on mental arithmetic.
- Do not make psychological or medical claims about the student.
- ${voice}
- Format math plainly (e.g. 3x + 5 = 20, x², √2, ½). Use **bold** sparingly.`;
}

export const TUTOR_TOOLS: BetaTool[] = [
  { name: 'calculate', description: 'Exactly evaluate an arithmetic expression (mathjs syntax, e.g. "3*7+2", "sqrt(50)", "(2/3)+(1/4)"). Use for every calculation you state.', input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'check_solution', description: 'Check whether a value solves an equation in one variable, e.g. equation "3x+5=20", variable "x", value "5".', input_schema: { type: 'object', properties: { equation: { type: 'string' }, variable: { type: 'string' }, value: { type: 'string' } }, required: ['equation', 'variable', 'value'] } },
];

export function runTutorTool(name: string, input: Record<string, unknown>): string {
  if (name === 'calculate') {
    const v = safeNumeric(String(input.expression ?? ''));
    return v === null ? 'Could not evaluate that expression.' : String(Math.round(v * 1e10) / 1e10);
  }
  if (name === 'check_solution') {
    const [l, r] = String(input.equation ?? '').split('=');
    const val = safeNumeric(String(input.value ?? ''));
    const varName = String(input.variable ?? 'x');
    if (!l || !r || val === null || !/^[a-z]$/i.test(varName)) return 'Invalid input.';
    const sub = (s: string) => safeNumeric(s.replace(new RegExp(`(\\d)${varName}`, 'g'), `$1*(${val})`).replace(new RegExp(`\\b${varName}\\b`, 'g'), `(${val})`));
    const L = sub(l), R = sub(r);
    if (L === null || R === null) return 'Could not evaluate.';
    return Math.abs(L - R) < 1e-9 ? `Correct: both sides equal ${L}.` : `Not a solution: left side = ${L}, right side = ${R}.`;
  }
  return 'Unknown tool.';
}

export async function tutorReply(p: ProfileRow, mm: Record<string, MasteryView>, message: string, history: TutorTurn[], ctx: TutorContext, recentMistakes: string[]): Promise<TutorResult> {
  // Answering a quiz the tutor posed is always checked deterministically.
  if (ctx.pendingQuiz && looksLikeAnswer(message)) {
    const res = checkAnswer(ctx.pendingQuiz, message);
    const reply = res.correct
      ? `${res.feedback} ${ctx.pendingQuiz.explanation}\n\nWant another one? Say "quiz me" or "make it harder".`
      : `${res.feedback}\n\nHint: ${ctx.pendingQuiz.hints[0]}\n\nTry again, or say "show me" to see a worked solution.`;
    return { reply, source: 'builtin', clearQuiz: res.correct };
  }
  if (aiConfigured()) {
    try {
      const messages: BetaMessageParam[] = [...history.slice(-16).map((t) => ({ role: t.role, content: t.content }) as BetaMessageParam), { role: 'user', content: message }];
      const reply = await aiText({ system: buildSystemPrompt(p, mm, ctx, recentMistakes), messages, tools: TUTOR_TOOLS, runTool: runTutorTool, maxTokens: 2000, effort: 'low' });
      const quiz = /quiz me|test me|give me a (question|problem)|practice question/i.test(message) ? makeQuiz(ctx, p, mm, message) : undefined;
      return { reply: quiz ? `${reply}\n\n${quiz.prompt}` : reply, source: 'ai', ...(quiz ? { quiz: toPublic(quiz), quizFull: quiz } : {}) };
    } catch (e) {
      if (!(e instanceof AIUnavailable)) console.warn('[tutor] AI error, using built-in tutor:', (e as Error).message);
    }
  }
  return builtinTutor(p, mm, message, ctx);
}

function looksLikeAnswer(m: string) {
  const s = m.trim();
  return s.length < 40 && /\d|^[a-d]$|true|false|^x\s*=|converges|diverges|\//i.test(s) && !/\?|hint|explain|why|how|example|harder|easier|quiz|help|show/i.test(s);
}

function makeQuiz(ctx: TutorContext, p: ProfileRow, mm: Record<string, MasteryView>, msg: string): Question {
  const skillId = ctx.skillId ?? ctx.question?.skillId ?? pickSkillFromText(msg) ?? nearestSkill(p, mm);
  let d = Math.max(1, Math.min(5, Math.round(1 + (mm[skillId]?.effective ?? 30) / 22)));
  if (/harder|challenge|difficult/i.test(msg)) d = Math.min(5, d + 1);
  if (/easier|simpler/i.test(msg)) d = Math.max(1, d - 1);
  return generateQuestion(skillId, d);
}

function pickSkillFromText(text: string): string | null {
  const t = text.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const s of SKILLS) {
    let score = 0;
    if (t.includes(s.title.toLowerCase())) score += 5;
    for (const tag of s.tags) if (t.includes(tag)) score += tag.length > 5 ? 2 : 1;
    if (score > (best?.score ?? 0)) best = { id: s.id, score };
  }
  return best && best.score >= 2 ? best.id : null;
}
function nearestSkill(p: ProfileRow, mm: Record<string, MasteryView>) {
  const lvl = p.learning_level ?? p.school_grade ?? 5;
  const cands = SKILLS.filter((s) => Math.abs(s.grade - lvl) <= 1 && !['puzzles'].includes(s.domain));
  const weakest = cands.sort((a, b) => (mm[a.id]?.effective ?? 40) - (mm[b.id]?.effective ?? 40));
  return weakest[0]?.id ?? 'two-step-eq';
}

/** Deterministic tutor: uses the question's own hints/steps, the curriculum and the solver. */
export function builtinTutor(p: ProfileRow, mm: Record<string, MasteryView>, message: string, ctx: TutorContext): TutorResult {
  const m = message.toLowerCase();
  const band = ageBandFor(p.school_grade);
  const q = ctx.question ?? ctx.pendingQuiz ?? null;
  const skill = SKILL_MAP[ctx.skillId ?? q?.skillId ?? ''] ?? (pickSkillFromText(message) ? SKILL_MAP[pickSkillFromText(message)!] : undefined);
  const learningMode = json<{ learningMode?: boolean }>(p.preferences, {}).learningMode !== false;
  const say = (reply: string, extra: Partial<TutorResult> = {}): TutorResult => ({ reply, source: 'builtin', ...extra });

  if (/^(hi|hello|hey|yo|good (morning|evening|afternoon))\b/.test(m)) return say(`Hi ${p.name}! 👋 What are you working on? You can ask me to explain an idea, give a hint, show an example, or quiz you.`);

  if (/quiz me|test me|give me a (question|problem)|practice question|another (question|problem)|make (it|this) (harder|easier)|harder|easier/.test(m)) {
    const quiz = makeQuiz(ctx, p, mm, message);
    return say(`Here’s one on **${SKILL_MAP[quiz.skillId].title}** (difficulty ${quiz.difficulty}/5):\n\n${quiz.prompt}\n\nType your answer here and I’ll check it.`, { quiz: toPublic(quiz), quizFull: quiz });
  }

  if (q && /full solution|show (me )?(the )?(answer|solution|working)|show me|i give up|just tell me/.test(m)) {
    if (learningMode && (ctx.helpLevel ?? 1) < 6 && !/full solution|just tell me|i give up/.test(m)) return say(`I can show you, but you’ll learn more if we take the next step together. Here’s the next step:\n\n${q.steps.find((s) => s.startsWith('SOLVE')) ?? q.steps[0]}\n\nIf you still want everything, say “show the full solution”.`);
    return say(`Here’s the full solution:\n\n${q.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n**Answer:** ${q.answer}${q.unit ? ` ${q.unit}` : ''}\n\n${q.explanation}`);
  }

  if (q && /(why).*(wrong|incorrect|not right)|what did i do wrong|is (this|my answer) (right|correct)/.test(m)) {
    if (!ctx.studentAnswer) return say('Type your answer in the box first, then I can look at where the reasoning changed.');
    const r = checkAnswer(q, ctx.studentAnswer);
    if (r.correct) return say('Actually, that answer is correct! 🎉 Can you explain why it works?');
    return say(`${r.feedback}\n\nLet’s check one step at a time. ${q.hints[Math.min(1, q.hints.length - 1)]}`);
  }

  if (q && /hint|stuck|help|don.?t tell me|clue|next step/.test(m)) {
    const lvl = Math.max(1, ctx.helpLevel ?? 2);
    if (lvl <= 1) return say(`What do you think the first step is? Tell me your idea — there’s no wrong guess here.`);
    if (lvl === 4 || /next step/.test(m)) return say(`Next step: ${q.steps.find((s) => s.startsWith('SOLVE'))?.replace('SOLVE: ', '') ?? q.hints[q.hints.length - 1]}\n\nWhat do you get when you do that?`);
    const hint = q.hints[Math.min(lvl - 2, q.hints.length - 1)];
    return say(`${hint}\n\n${band === 'early' ? 'You can do it! 💪' : 'What do you notice when you try that?'}`);
  }

  if (/example/.test(m) && (skill || q)) {
    const ex = generateQuestion((skill ?? SKILL_MAP[q!.skillId]).id, q?.difficulty ?? 2);
    return say(`Here’s a similar example with different numbers:\n\n**${ex.prompt}**\n\n${ex.steps.map((s) => `• ${s}`).join('\n')}\n\n**Answer:** ${ex.answer}${ex.unit ? ` ${ex.unit}` : ''}\n\nNow try your problem using the same steps.`, { example: { prompt: ex.prompt, steps: ex.steps, answer: ex.answer } });
  }

  // A typed problem/equation: guide with the solver (Socratic first, answer only on request)
  if (extractEquation(message) || /^[\d\s+\-*/^().×÷−]+$/.test(message.trim()) || /\b(find|solve|calculate|what is)\b.*\d/.test(m)) {
    const a = analyzeProblem(message);
    if (a.kind !== 'unknown') {
      if (!learningMode || /answer|solution|show/.test(m)) return say(`**Understand:** ${a.understand}\n**Plan:** ${a.plan}\n${a.steps.map((s, i) => `**Step ${i + 1}:** ${s.explanation}`).join('\n')}\n**Check:** ${a.check}\n\n**Answer:** ${a.finalAnswer}`);
      return say(`Let’s think it through together.\n\n**Understand:** ${a.understand}\n**Plan:** ${a.plan}\n\n${a.steps[0].prompt}`);
    }
  }

  if (/like i.?m (5|6|7|8|9|10|ten|five)|simpl(e|er)|eli5/.test(m) && skill) return say(`Imagine this: ${skill.realWorld} ${skill.learn[0]} The big idea: ${skill.keyIdea}`);
  if (/university|rigorous|formal|advanced level/.test(m) && skill) return say(`${skill.title} — formally: ${skill.keyIdea}. ${skill.learn.join(' ')} Typical applications: ${skill.realWorld}`);

  if (skill && /explain|what is|what are|how do|why|mean|understand|teach/.test(m)) {
    return say(`**${skill.title}**\n\n${skill.learn.join('\n\n')}\n\n**Key idea:** ${skill.keyIdea}\n**Where it’s used:** ${skill.realWorld}\n\nWant an example, or shall I quiz you?`);
  }
  if (q) return say(`Let’s focus on the problem on your screen. Start with UNDERSTAND: what is it asking you to find? If you’d like, ask for a hint, an example, or say “next step”.`);
  return say(`I can help in lots of ways:\n• “Explain fractions”\n• “Give me a hint”\n• “Show me an example”\n• “Quiz me on algebra”\n• Type a problem like “Solve 3x + 5 = 20”\n\nWhat would you like to work on?`);
}

/** Score an "Explain it" response (built-in rubric; AI refines it when available). */
export async function evaluateExplanation(skillId: string, text: string, p: ProfileRow): Promise<{ score: number; feedback: string; matched: string[]; missing: string[]; source: 'ai' | 'builtin' }> {
  const skill = SKILL_MAP[skillId];
  const t = text.toLowerCase();
  const matched = skill.explainKeywords.filter((k) => t.includes(k.toLowerCase()));
  const missing = skill.explainKeywords.filter((k) => !matched.includes(k));
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  let score = Math.min(100, Math.round((matched.length / Math.max(2, Math.min(4, skill.explainKeywords.length))) * 75 + Math.min(25, words)));
  if (words < 5) score = Math.min(score, 30);
  let feedback = score >= 75 ? 'Clear explanation — you used the key ideas.' : score >= 45 ? `Good start! Try to also mention: ${missing.slice(0, 2).join(', ')}.` : `Keep building it. A strong explanation might mention: ${missing.slice(0, 3).join(', ')}.`;
  if (aiConfigured() && words >= 5) {
    try {
      const reply = await aiText({
        system: `You assess a ${gradeLabel(p.school_grade, p.curriculum)} student's explanation of "${skill.title}" (key idea: ${skill.keyIdea}). Reply in 2-3 short, kind sentences: what is right, then one concrete improvement. Never shame. Start your reply with a score 0-100 in the form "SCORE: n".`,
        messages: [{ role: 'user', content: `Prompt: ${skill.explainPrompt}\nStudent explanation: ${text.slice(0, 2000)}` }], maxTokens: 600, effort: 'low',
      });
      const sm = reply.match(/SCORE:\s*(\d{1,3})/i);
      if (sm) score = Math.round((Math.min(100, Number(sm[1])) + score) / 2);
      feedback = reply.replace(/SCORE:\s*\d{1,3}\s*/i, '').trim() || feedback;
      return { score, feedback, matched, missing, source: 'ai' };
    } catch { /* fall back */ }
  }
  return { score, feedback, matched, missing, source: 'builtin' };
}
