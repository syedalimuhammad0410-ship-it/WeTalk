// AI-facing features: tutor chat, homework helper, Learn Anything, topic requests, presentation practice.
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Request } from 'express';
import type { Question } from '../../shared/types.ts';
import { SKILL_MAP } from '../../shared/skills.ts';
import { PRESENTATION_TOPICS, gradeLabel } from '../../shared/curriculum.ts';
import { config } from '../config.ts';
import { all, json, one, run } from '../db.ts';
import { requireProfile, type ProfileRow } from '../auth.ts';
import { HttpError, bad, notFound, num, oneOf, rateLimit, str } from '../security.ts';
import { awardXp, checkAchievements, masteryMap, recordActivity } from '../learning.ts';
import { aiConfigured, aiJSON, AIUnavailable, imageBlock, S } from '../ai/provider.ts';
import { tutorReply, type TutorContext, type TutorTurn } from '../ai/tutor.ts';
import { analyzeProblem, extractHighlights, type Analysis } from '../engine/solver.ts';
import { checkAnswer, safeNumeric, toNumber } from '../engine/check.ts';
import { buildCourse, LEVELS, normalizeTopic, STYLES } from '../coursegen.ts';
import { loadIssued } from './learn.ts';
import { track } from '../analytics.ts';

export const aiRouter = Router();
aiRouter.use(requireProfile);
const P = (req: Request) => req.profile!;
const prefs = (p: ProfileRow) => json<Record<string, unknown>>(p.preferences, {});
const aiLimiter = rateLimit('ai', config.ai.rateLimitPerMin, 60_000, (req) => req.user?.id ?? req.ip ?? 'anon');

// ─────────────────────────────────────────── Tutor
aiRouter.post('/tutor', aiLimiter, async (req, res) => {
  const p = P(req);
  const message = str(req.body?.message, 'Message', { max: 2000 });
  const c = req.body?.context ?? {};
  const convId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
  const conv = convId ? one<{ id: string; messages: string; context: string | null }>('SELECT * FROM ai_conversations WHERE id = ? AND profile_id = ?', convId, p.id) : null;
  const history = json<TutorTurn[]>(conv?.messages, []);
  const convCtx = json<{ pendingQuiz?: Question | null }>(conv?.context ?? null, {});
  const ctx: TutorContext = {
    skillId: typeof c.skillId === 'string' && (SKILL_MAP[c.skillId] || c.skillId.startsWith('gen:')) ? c.skillId : undefined,
    helpLevel: c.helpLevel ? num(c.helpLevel, 'help level', { min: 1, max: 6, int: true }) ?? undefined : undefined,
    studentAnswer: typeof c.studentAnswer === 'string' ? c.studentAnswer.slice(0, 200) : undefined,
    lessonStage: typeof c.lessonStage === 'string' ? c.lessonStage.slice(0, 20) : undefined,
    pendingQuiz: convCtx.pendingQuiz ?? null,
  };
  if (typeof c.questionId === 'string') { try { ctx.question = loadIssued(p.id, c.questionId).q; ctx.skillId ??= ctx.question.skillId; } catch { /* expired */ } }
  if (typeof c.homeworkId === 'string') {
    const hw = one<{ problem_text: string | null; analysis: string | null }>('SELECT problem_text, analysis FROM homework_sessions WHERE id = ? AND profile_id = ?', c.homeworkId, p.id);
    if (hw) ctx.homework = `${hw.problem_text ?? ''}\n${hw.analysis ? `Tutoring plan: ${JSON.stringify(json(hw.analysis, {})).slice(0, 2500)}` : ''}`;
  }
  const recentMistakes = all<{ mistake_type: string; skill_id: string }>("SELECT mistake_type, skill_id FROM question_attempts WHERE profile_id = ? AND correct = 0 AND mistake_type IS NOT NULL AND mistake_type != 'other' ORDER BY id DESC LIMIT 5", p.id).map((m) => `${m.mistake_type} in ${SKILL_MAP[m.skill_id]?.title ?? m.skill_id}`);
  let result;
  try {
    result = await tutorReply(p, masteryMap(p.id), message, history, ctx, recentMistakes);
  } catch (e) {
    if (e instanceof AIUnavailable) throw new HttpError(503, 'Your tutor is temporarily unavailable. Try again.', 'ai_unavailable');
    throw e;
  }
  const newHistory = [...history, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: result.reply }].slice(-40);
  const nextQuiz = result.quizFull ?? (result.clearQuiz ? null : ctx.pendingQuiz ?? null);
  let id = conv?.id ?? null;
  if (prefs(p).saveTutorHistory !== false) {
    if (id) run("UPDATE ai_conversations SET messages = ?, context = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(newHistory), JSON.stringify({ pendingQuiz: nextQuiz }), id);
    else { id = randomUUID(); run('INSERT INTO ai_conversations (id, profile_id, title, messages, context) VALUES (?, ?, ?, ?, ?)', id, p.id, message.slice(0, 60), JSON.stringify(newHistory), JSON.stringify({ pendingQuiz: nextQuiz })); }
  } else if (!id) {
    // Keep only the quiz state (no message history) when the learner opted out of saving chats.
    id = randomUUID(); run('INSERT INTO ai_conversations (id, profile_id, title, messages, context) VALUES (?, ?, ?, ?, ?)', id, p.id, 'Private session', '[]', JSON.stringify({ pendingQuiz: nextQuiz }));
  } else run("UPDATE ai_conversations SET context = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify({ pendingQuiz: nextQuiz }), id);
  recordActivity(p.id, 30);
  track('tutor_message', { ai: result.source === 'ai', source: ctx.question ? 'question' : ctx.homework ? 'homework' : 'chat' }, prefs(p).analyticsOptOut === true);
  res.json({ reply: result.reply, source: result.source, conversationId: id, quiz: result.quiz ?? null, example: result.example ?? null });
});

aiRouter.get('/tutor/history', (req, res) => {
  const p = P(req);
  const conv = one<{ id: string; messages: string }>('SELECT id, messages FROM ai_conversations WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1', p.id);
  res.json({ conversationId: conv?.id ?? null, messages: json(conv?.messages, []) });
});
aiRouter.delete('/tutor/history', (req, res) => {
  run('DELETE FROM ai_conversations WHERE profile_id = ?', P(req).id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── Homework helper
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAGIC: [string, number[]][] = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46]], ['image/webp', [0x52, 0x49, 0x46, 0x46]], ['application/pdf', [0x25, 0x50, 0x44, 0x46]]];
function sniff(buf: Buffer): string | null {
  for (const [mime, sig] of MAGIC) if (sig.every((b, i) => buf[i] === b)) { if (mime === 'image/webp' && buf.subarray(8, 12).toString() !== 'WEBP') continue; return mime; }
  return null;
}

const HOMEWORK_SCHEMA = S.obj({
  readable: S.bool(), message: S.str('If not readable, a short friendly explanation; else empty'),
  problems: S.arr(S.obj({ text: S.str('The full problem text, transcribed exactly'), bbox: S.obj({ x: S.num('left, % of width 0-100'), y: S.num('top %'), w: S.num('width %'), h: S.num('height %') }) })),
  selected: S.int('index of the main problem to tutor'),
  regions: S.arr(S.obj({ label: S.str('the exact text/number in the region'), kind: S.enm(['given', 'asked', 'formula', 'value', 'unit', 'mistake', 'step', 'diagram']), explanation: S.str('what this part means, for the student'), bbox: S.obj({ x: S.num(), y: S.num(), w: S.num(), h: S.num() }) })),
  studentWork: S.obj({ present: S.bool(), assessment: S.str('Kind, specific feedback on handwritten work; empty if none'), errorStep: S.str('Where the reasoning first changed, or empty') }),
  tutoring: S.obj({
    understand: S.str(), asked: S.str(), given: S.arr(S.obj({ label: S.str(), value: S.str() })), concept: S.str(), plan: S.str(),
    steps: S.arr(S.obj({ prompt: S.str('A Socratic question for the student'), expected: S.str('short expected answer, numeric if possible, else empty'), hint: S.str(), explanation: S.str() })),
    check: S.str(), finalAnswer: S.str(), communicate: S.str('A model complete-sentence answer'),
  }),
  verification: S.obj({ kind: S.enm(['equation', 'numeric', 'none']), expr: S.str('numeric: mathjs expression equal to the final answer; equation: e.g. 3*x+5=20'), variable: S.str() }),
});
interface HomeworkAI { readable: boolean; message: string; problems: { text: string; bbox: Box }[]; selected: number; regions: { label: string; kind: string; explanation: string; bbox: Box }[]; studentWork: { present: boolean; assessment: string; errorStep: string }; tutoring: Omit<Analysis, 'kind' | 'problem' | 'highlights' | 'verified' | 'verification' | 'finalAnswer' | 'communicate'> & { finalAnswer: string; communicate: string }; verification: { kind: 'equation' | 'numeric' | 'none'; expr: string; variable: string } }
type Box = { x: number; y: number; w: number; h: number };

function verifyAiAnswer(ai: HomeworkAI): { verified: boolean; note?: string } {
  const v = ai.verification; const fa = ai.tutoring.finalAnswer;
  try {
    if (v.kind === 'numeric') { const a = toNumber(fa.replace(/^[a-z]\s*=\s*/i, '').split(' ')[0]); const e = safeNumeric(v.expr); return { verified: a !== null && e !== null && Math.abs(a - e) <= Math.max(1e-6, Math.abs(e) * 1e-4) }; }
    if (v.kind === 'equation') {
      const vals = fa.replace(/[a-z]\s*=\s*/gi, '').split(/,|or|and/).map((s) => toNumber(s.trim())).filter((x): x is number => x !== null);
      const [l, r] = v.expr.split('=');
      const ok = vals.length > 0 && vals.every((val) => { const L = safeNumeric(l.replace(new RegExp(`\\b${v.variable || 'x'}\\b`, 'g'), `(${val})`)); const R = safeNumeric(r.replace(new RegExp(`\\b${v.variable || 'x'}\\b`, 'g'), `(${val})`)); return L !== null && R !== null && Math.abs(L - R) < 1e-6; });
      return { verified: ok };
    }
  } catch { /* fall through */ }
  return { verified: false, note: 'This answer could not be machine-checked. Double-check each step.' };
}

async function analyzeWithAI(p: ProfileRow, problemText: string | null, image?: { base64: string; mime: string }) {
  const content = [
    ...(image ? [imageBlock(image.base64, image.mime)] : []),
    { type: 'text' as const, text: `${image ? 'This is a photo/screenshot of math homework.' : `Homework problem: ${problemText}`}\nThe student is at ${gradeLabel(p.school_grade, p.curriculum)} level. Identify the problem(s)${image ? ', locate key regions with bounding boxes as percentages of the image, and assess any handwritten work' : ''}, and build a step-by-step tutoring plan (Understand → Identify information → Plan → Solve → Check → Communicate). Steps must be Socratic questions — the student should do the thinking. Provide a verification block a math engine can evaluate.` },
  ];
  return aiJSON<HomeworkAI>({ system: 'You are Mathly’s homework tutor. Read math problems accurately (including handwriting when legible). If the image is unclear, set readable=false. Never shame mistakes; describe where reasoning changed. Do not make up content that is not in the image.', messages: [{ role: 'user', content }], schema: HOMEWORK_SCHEMA, maxTokens: 12000, effort: 'medium' });
}

function builtInAnalysis(text: string) {
  const a = analyzeProblem(text);
  return { source: 'builtin', problems: [{ text, bbox: null }], selected: 0, regions: [], highlights: extractHighlights(text), studentWork: null, tutoring: a, verified: a.verified, verifyNote: a.finalAnswer ? 'Checked by Mathly’s math engine.' : null };
}

aiRouter.post('/homework', aiLimiter, async (req, res) => {
  const p = P(req);
  const text = str(req.body?.text, 'Problem', { optional: true, max: 2000 });
  const imageB64 = typeof req.body?.image === 'string' ? req.body.image.replace(/^data:[^,]+,/, '') : null;
  if (!text && !imageB64) throw bad('Upload a photo or type the problem.');
  const id = randomUUID();
  let file: string | null = null, mime: string | null = null;
  if (imageB64) {
    const buf = Buffer.from(imageB64, 'base64');
    if (buf.length > MAX_UPLOAD) throw new HttpError(413, 'That file is too large. Please use an image under 8 MB.', 'too_large');
    mime = sniff(buf);
    if (!mime) throw bad('That file type isn’t supported. Please upload a PNG, JPG, WEBP, GIF or PDF.');
    mkdirSync(config.uploadDir, { recursive: true });
    file = `${id}.${mime.split('/')[1]}`;
    writeFileSync(path.join(config.uploadDir, file), buf, { mode: 0o600 }); // original is never modified
  }
  let analysis: unknown; let problemText = text || null;
  if (aiConfigured()) {
    try {
      const ai = await analyzeWithAI(p, text || null, imageB64 && mime ? { base64: imageB64, mime } : undefined);
      if (!ai.readable && imageB64) analysis = { source: 'ai', unreadable: true, message: ai.message || 'I couldn’t clearly read this problem. Try taking a closer photo.' };
      else {
        const sel = ai.problems[ai.selected] ?? ai.problems[0];
        problemText = text || sel?.text || null;
        const ver = verifyAiAnswer(ai);
        // Cross-check with the built-in solver where it can solve the problem itself.
        const local = problemText ? analyzeProblem(problemText) : null;
        let verifyNote = ver.verified ? 'Answer verified by Mathly’s math engine.' : ver.note ?? null;
        if (local?.verified && local.finalAnswer && !ver.verified) { ai.tutoring.finalAnswer = local.finalAnswer; verifyNote = 'Answer computed and verified by Mathly’s math engine.'; }
        analysis = { source: 'ai', problems: ai.problems, selected: ai.selected, regions: ai.regions, studentWork: ai.studentWork, tutoring: ai.tutoring, highlights: problemText ? extractHighlights(problemText) : [], verified: ver.verified || !!local?.verified, verifyNote };
      }
    } catch (e) {
      console.warn('[homework] AI analysis failed:', (e as Error).message);
      analysis = text ? { ...builtInAnalysis(text), aiError: true } : { source: 'none', unreadable: true, aiError: true, message: 'Your tutor is temporarily unavailable. Type the problem below and I’ll help you work through it.' };
    }
  } else analysis = text ? builtInAnalysis(text) : { source: 'none', needsText: true, message: 'Reading photos needs the AI vision service, which isn’t connected on this server. Type the problem below and I’ll help you work through it step by step.' };
  run('INSERT INTO homework_sessions (id, profile_id, image_file, image_mime, problem_text, analysis) VALUES (?, ?, ?, ?, ?, ?)', id, p.id, file, mime, problemText, JSON.stringify(analysis));
  recordActivity(p.id, 30);
  track('homework_started', { kind: imageB64 ? 'image' : 'text', ai: aiConfigured() }, prefs(p).analyticsOptOut === true);
  res.json({ session: sessionView(id, p.id) });
});

function sessionView(id: string, profileId: string) {
  const s = one<{ id: string; image_file: string | null; image_mime: string | null; problem_text: string | null; analysis: string; step: number; completed: number; created_at: string }>('SELECT * FROM homework_sessions WHERE id = ? AND profile_id = ?', id, profileId);
  if (!s) throw notFound('Homework session not found');
  const analysis = json<Record<string, unknown>>(s.analysis, {});
  // Hide the final answer until the student has worked the steps (Learning Mode default).
  const tut = analysis.tutoring as Analysis | undefined;
  const steps = tut?.steps ?? [];
  const revealed = s.completed || s.step >= steps.length;
  const safeTut = tut ? { ...tut, finalAnswer: revealed ? tut.finalAnswer : tut.finalAnswer ? 'hidden' : null, communicate: revealed ? tut.communicate : null, steps: steps.map((st, i) => ({ ...st, expected: undefined, explanation: i < s.step ? st.explanation : undefined })) } : null;
  return { id: s.id, hasImage: !!s.image_file, mime: s.image_mime, problemText: s.problem_text, step: s.step, completed: !!s.completed, createdAt: s.created_at, analysis: { ...analysis, tutoring: safeTut } };
}

aiRouter.get('/homework', (req, res) => {
  const p = P(req);
  res.json({ sessions: all('SELECT id, problem_text, completed, created_at, image_file IS NOT NULL AS has_image FROM homework_sessions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 30', p.id) });
});
aiRouter.get('/homework/:id', (req, res) => res.json({ session: sessionView(req.params.id, P(req).id) }));
aiRouter.get('/homework/:id/image', (req, res) => {
  const s = one<{ image_file: string | null; image_mime: string | null }>('SELECT image_file, image_mime FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, P(req).id);
  if (!s?.image_file) throw notFound('No image');
  const f = path.join(config.uploadDir, path.basename(s.image_file));
  if (!existsSync(f)) throw notFound('Image missing');
  res.setHeader('Content-Type', s.image_mime ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', 'inline');
  createReadStream(f).pipe(res);
});
/** Provide/replace the typed problem text (e.g., when the image couldn't be read). */
aiRouter.patch('/homework/:id', aiLimiter, async (req, res) => {
  const p = P(req);
  const text = str(req.body?.text, 'Problem', { max: 2000 });
  const s = one<{ id: string; image_file: string | null; image_mime: string | null }>('SELECT id, image_file, image_mime FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!s) throw notFound('Homework session not found');
  let analysis: unknown = builtInAnalysis(text);
  if (aiConfigured()) {
    try {
      const ai = await analyzeWithAI(p, text);
      const ver = verifyAiAnswer(ai); const local = analyzeProblem(text);
      if (local.verified && local.finalAnswer && !ver.verified) ai.tutoring.finalAnswer = local.finalAnswer;
      analysis = { source: 'ai', problems: [{ text, bbox: null }], selected: 0, regions: [], highlights: extractHighlights(text), studentWork: null, tutoring: ai.tutoring, verified: ver.verified || local.verified, verifyNote: ver.verified || local.verified ? 'Answer verified by Mathly’s math engine.' : ver.note ?? null };
    } catch { /* keep built-in */ }
  }
  run('UPDATE homework_sessions SET problem_text = ?, analysis = ?, step = 0, completed = 0 WHERE id = ?', text, JSON.stringify(analysis), s.id);
  res.json({ session: sessionView(s.id, p.id) });
});

aiRouter.post('/homework/:id/step', (req, res) => {
  const p = P(req);
  const s = one<{ id: string; analysis: string; step: number; completed: number }>('SELECT id, analysis, step, completed FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!s) throw notFound('Homework session not found');
  const tut = json<{ tutoring?: Analysis }>(s.analysis, {}).tutoring;
  if (!tut) throw bad('No tutoring plan for this problem.');
  const step = tut.steps[s.step];
  if (!step) return res.json({ done: true, session: sessionView(s.id, p.id) });
  const answer = str(req.body?.answer, 'Answer', { optional: true, max: 300 });
  const skip = req.body?.skip === true;
  let correct = true; let feedback = 'Good thinking.';
  if (step.expected && !skip) {
    const exp = step.expected.trim();
    const qLike: Question = { id: 'hw', skillId: 'hw', prompt: step.prompt, answerType: /,/.test(exp) ? 'set' : toNumber(exp) !== null ? 'number' : 'text', answer: exp, hints: [step.hint], steps: [step.explanation], explanation: step.explanation, difficulty: 2, verify: { kind: 'none', reason: '' }, tolerance: 0.011 };
    correct = checkAnswer(qLike, answer).correct || (qLike.answerType === 'text' && !!answer && (answer.toLowerCase().includes(exp.toLowerCase()) || exp.toLowerCase().includes(answer.toLowerCase())));
    feedback = correct ? 'Yes! That’s right.' : `You’re close. ${step.hint}`;
  } else if (!answer && !skip) { correct = false; feedback = 'Type what you think — any idea is a good start.'; }
  const attempts = Number(req.body?.attempt ?? 1);
  const advance = correct || skip || attempts >= 3;
  if (advance) run('UPDATE homework_sessions SET step = step + 1 WHERE id = ?', s.id);
  recordActivity(p.id, 20);
  res.json({ correct, feedback, explanation: advance ? step.explanation : null, advanced: advance, session: sessionView(s.id, p.id) });
});

/** "Show Full Solution" for review: reveals every step and the final answer. */
aiRouter.post('/homework/:id/reveal', (req, res) => {
  const p = P(req);
  const s = one<{ id: string; analysis: string }>('SELECT id, analysis FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!s) throw notFound('Homework session not found');
  const steps = json<{ tutoring?: Analysis }>(s.analysis, {}).tutoring?.steps.length ?? 0;
  run('UPDATE homework_sessions SET step = ? WHERE id = ?', steps, s.id);
  res.json({ session: sessionView(s.id, p.id) });
});

aiRouter.post('/homework/:id/complete', (req, res) => {
  const p = P(req);
  const s = one<{ completed: number }>('SELECT completed FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, p.id);
  if (!s) throw notFound('Homework session not found');
  let xp = 0;
  if (!s.completed) { run('UPDATE homework_sessions SET completed = 1 WHERE id = ?', req.params.id); xp = awardXp(p.id, 'homework_complete', 'Homework problem'); }
  res.json({ xp, achievements: checkAchievements(p.id), session: sessionView(req.params.id, p.id) });
});
aiRouter.delete('/homework/:id', (req, res) => {
  const s = one<{ image_file: string | null }>('SELECT image_file FROM homework_sessions WHERE id = ? AND profile_id = ?', req.params.id, P(req).id);
  if (!s) throw notFound();
  if (s.image_file) { try { unlinkSync(path.join(config.uploadDir, path.basename(s.image_file))); } catch { /* already gone */ } }
  run('DELETE FROM homework_sessions WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── Learn Anything & topic requests
aiRouter.post('/learn-anything', aiLimiter, async (req, res) => {
  const p = P(req);
  const topic = str(req.body?.topic, 'Topic', { min: 2, max: 200 });
  const reason = str(req.body?.reason, 'Reason', { optional: true, max: 500 });
  const level = req.body?.level ? oneOf(req.body.level, 'Level', LEVELS) : undefined;
  const style = req.body?.style ? oneOf(req.body.style, 'Style', STYLES) : undefined;
  const result = await buildCourse(p, masteryMap(p.id), { topic, reason, level, style });
  let courseId: string | null = null;
  if (result.course) {
    courseId = result.course.id;
    run('INSERT INTO courses (id, owner_profile_id, title, description, data, generated_by, status, request_topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', courseId, p.id, result.course.title, result.course.description, JSON.stringify(result.course), result.course.generatedBy, 'personal', topic);
    run('INSERT OR IGNORE INTO enrollments (profile_id, course_id) VALUES (?, ?)', p.id, courseId);
  }
  run('INSERT INTO topic_requests (id, profile_id, topic, normalized_topic, reason, level, style, course_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', randomUUID(), p.id, topic, normalizeTopic(topic) || topic.toLowerCase(), reason || null, level ?? null, style ?? null, courseId);
  const achievements = courseId ? checkAchievements(p.id) : [];
  track('course_requested', { ai: aiConfigured(), source: result.course?.generatedBy ?? 'none' }, prefs(p).analyticsOptOut === true);
  res.json({ courseId, message: result.message, suggestions: result.suggestions, achievements, generatedBy: result.course?.generatedBy ?? null });
});
aiRouter.get('/topic-requests', (req, res) => {
  res.json({ requests: all('SELECT id, topic, reason, level, style, course_id, status, created_at FROM topic_requests WHERE profile_id = ? ORDER BY created_at DESC', P(req).id) });
});
aiRouter.delete('/courses/:id', (req, res) => {
  const p = P(req);
  const r = run('DELETE FROM courses WHERE id = ? AND owner_profile_id = ?', req.params.id, p.id);
  if (!r.changes) throw notFound();
  run('DELETE FROM enrollments WHERE course_id = ?', req.params.id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────── Presentation practice
const FILLERS = ['um', 'uh', 'erm', 'uhm', 'hmm', 'you know', 'basically', 'kind of', 'sort of', 'i mean', 'like,'];
const NUMWORD: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fifteen: '15', twenty: '20', 'twenty five': '25', 'twenty-five': '25', hundred: '100' };

export function analyzePresentation(topicId: string, transcript: string, durationSec: number | null, pauses: number[]) {
  const topic = PRESENTATION_TOPICS.find((t) => t.id === topicId) ?? PRESENTATION_TOPICS[PRESENTATION_TOPICS.length - 1];
  const raw = transcript.trim(); const t = ` ${raw.toLowerCase().replace(/\s+/g, ' ')} `;
  const words = raw.split(/\s+/).filter(Boolean);
  const wc = words.length;
  const fillerCounts = FILLERS.map((f) => ({ f: f.replace(',', ''), n: (t.match(new RegExp(`[\\s,.]${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,.]`, 'g')) ?? []).length })).filter((x) => x.n > 0);
  const fillerTotal = fillerCounts.reduce((s, x) => s + x.n, 0);
  const covered = topic.concepts.map((c) => ({ label: c.label, covered: c.keywords.some((k) => t.includes(k.toLowerCase())) }));
  const vocabUsed = topic.vocabulary.filter((v) => t.includes(v.toLowerCase()));
  const quarter = t.slice(0, Math.max(40, Math.floor(t.length * 0.35)));
  const definedEarly = topic.concepts[0]?.keywords.some((k) => quarter.includes(k.toLowerCase())) ?? false;
  const hasExample = /for example|for instance|let'?s say|let’s say|imagine|suppose/.test(t);
  const hasConclusion = /(in summary|to sum up|so the answer|in conclusion|therefore|that'?s why|that’s why|overall)/.test(t.slice(Math.floor(t.length * 0.6)));
  const reasoning = (t.match(/\b(because|so|therefore|which means|this means|since|that'?s why)\b/g) ?? []).length;
  // Arithmetic statements like "3 squared plus 4 squared equals 25" or "9 + 16 = 25" are checked.
  let normalized = t; for (const [w, d] of Object.entries(NUMWORD)) normalized = normalized.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
  normalized = normalized.replace(/\bsquared\b/g, '^2').replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\btimes\b|\bmultiplied by\b/g, '*').replace(/\bdivided by\b|\bover\b/g, '/').replace(/\bequals\b|\bis equal to\b|\bgives\b/g, '=');
  const mathErrors: string[] = []; const mathChecked: string[] = [];
  for (const m of normalized.matchAll(/(\d+(?:\.\d+)?(?:\s*(?:\^2|[+\-*/])\s*\d*(?:\.\d+)?)+(?:\s*\^2)?)\s*=\s*(\d+(?:\.\d+)?)/g)) {
    const lhs = safeNumeric(m[1]); const rhs = Number(m[2]);
    if (lhs === null) continue;
    mathChecked.push(`${m[1].trim()} = ${m[2]}`);
    if (Math.abs(lhs - rhs) > 1e-6) mathErrors.push(`You said ${m[1].trim()} = ${m[2]}, but it equals ${Math.round(lhs * 1000) / 1000}.`);
  }
  const wpm = durationSec && durationSec > 5 ? Math.round(wc / (durationSec / 60)) : null;
  const longPauses = pauses.filter((x) => x >= 3).length;
  const coverage = covered.filter((c) => c.covered).length / Math.max(1, covered.length);
  const fillerRate = wc ? (fillerTotal / wc) * 100 : 0;
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const scores = {
    accuracy: clamp(coverage * 100 - mathErrors.length * 20 + (mathChecked.length && !mathErrors.length ? 5 : 0)),
    clarity: clamp(100 - fillerRate * 6 - (wc < 40 ? 30 : 0) - longPauses * 4),
    organization: clamp((definedEarly ? 40 : 10) + (hasExample ? 35 : 0) + (hasConclusion ? 25 : 5)),
    vocabulary: clamp(topic.vocabulary.length ? (vocabUsed.length / topic.vocabulary.length) * 100 : 70),
    reasoning: clamp(30 + reasoning * 14),
    pace: wpm === null ? null : clamp(wpm < 90 ? 60 + (wpm - 60) : wpm > 180 ? 100 - (wpm - 180) : 100),
  };
  const parts = [scores.accuracy * 0.35, scores.clarity * 0.2, scores.organization * 0.2, scores.vocabulary * 0.1, scores.reasoning * 0.15];
  const overall = clamp(parts.reduce((a, b) => a + b, 0));
  const strengths: string[] = []; const improvements: string[] = [];
  if (definedEarly) strengths.push('You introduced the main idea before using it.'); else improvements.push(`Try defining the key idea first — for example: “${topic.concepts[0]?.label}”.`);
  if (hasExample) strengths.push('You used an example, which makes the idea concrete.'); else improvements.push('Add a worked example with real numbers.');
  if (hasConclusion) strengths.push('You wrapped up with a clear conclusion.'); else improvements.push('Finish with a one-sentence summary of what you showed.');
  if (fillerTotal >= 3) improvements.push(`You used ${fillerTotal} filler word${fillerTotal > 1 ? 's' : ''} (${fillerCounts.map((x) => `“${x.f}” ×${x.n}`).join(', ')}). Pausing silently instead can sound more confident.`);
  else if (wc > 30) strengths.push('Very few filler words.');
  if (longPauses >= 2) improvements.push(`You paused ${longPauses} times for 3 seconds or more. Planning your next step before speaking can help.`);
  if (wpm !== null) (wpm > 180 ? improvements : strengths).push(wpm > 180 ? `You spoke quickly (about ${wpm} words per minute). Slowing down gives listeners time to follow the math.` : `Your pace was comfortable (about ${wpm} words per minute).`);
  if (reasoning >= 3) strengths.push('You explained WHY, not just what (“because”, “so”, “therefore”).'); else improvements.push('Explain why each step works using words like “because” or “so”.');
  for (const e of mathErrors) improvements.unshift(e);
  const missingConcepts = covered.filter((c) => !c.covered).map((c) => c.label);
  return { topic: { id: topic.id, title: topic.title }, overall, scores, wordCount: wc, wpm, fillerCount: fillerTotal, fillers: fillerCounts, longPauses, conceptsCovered: covered, vocabularyUsed: vocabUsed, mathChecked, mathErrors, strengths, improvements, missingConcepts };
}

aiRouter.get('/presentations/topics', (_req, res) => res.json({ topics: PRESENTATION_TOPICS.map((t) => ({ id: t.id, title: t.title, prompt: t.prompt, skillId: t.skillId, concepts: t.concepts.map((c) => c.label) })) }));
aiRouter.get('/presentations', (req, res) => res.json({ sessions: all('SELECT id, topic_id, topic_title, mode, score, duration_s, created_at FROM presentation_sessions WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20', P(req).id) }));
aiRouter.get('/presentations/:id', (req, res) => {
  const s = one<{ feedback: string; transcript: string; topic_title: string; mode: string; created_at: string }>('SELECT * FROM presentation_sessions WHERE id = ? AND profile_id = ?', req.params.id, P(req).id);
  if (!s) throw notFound();
  res.json({ session: { ...s, feedback: json(s.feedback, {}) } });
});

aiRouter.post('/presentations', aiLimiter, async (req, res) => {
  const p = P(req);
  const topicId = oneOf(req.body?.topicId, 'Topic', PRESENTATION_TOPICS.map((t) => t.id));
  const mode = oneOf(req.body?.mode, 'Mode', ['voice', 'video', 'typed'] as const);
  const transcript = str(req.body?.transcript, 'Explanation', { min: 3, max: 10000 });
  const customTitle = str(req.body?.customTitle, 'Topic title', { optional: true, max: 120 });
  const duration = num(req.body?.durationSec, 'duration', { min: 0, max: 3600, optional: true });
  const pauses = Array.isArray(req.body?.pauses) ? (req.body.pauses as unknown[]).map(Number).filter((x) => Number.isFinite(x) && x >= 0 && x < 600).slice(0, 200) : [];
  const fb: ReturnType<typeof analyzePresentation> & { ai?: { summary: string; strengths: string[]; improvements: string[]; missingConcepts: string[]; mathIssues: string[] } } = analyzePresentation(topicId, transcript, duration, pauses);
  const title = topicId === 'custom' && customTitle ? customTitle : fb.topic.title;
  if (aiConfigured()) {
    try {
      fb.ai = await aiJSON({
        system: 'You give constructive, specific, kind feedback on a student’s spoken or written math explanation. Comment only on observable behaviour and content (accuracy, clarity, organization, vocabulary, reasoning). Never make psychological or medical claims about the student. Never shame.',
        messages: [{ role: 'user', content: `Student level: ${gradeLabel(p.school_grade, p.curriculum)}\nTopic: ${title}\nTask: ${PRESENTATION_TOPICS.find((t) => t.id === topicId)?.prompt}\nTranscript (may contain speech-recognition errors):\n"""${transcript.slice(0, 6000)}"""\nAutomatic metrics: ${JSON.stringify({ wpm: fb.wpm, fillers: fb.fillerCount, longPauses: fb.longPauses, mathErrors: fb.mathErrors })}` }],
        schema: S.obj({ summary: S.str(), strengths: S.arr(S.str()), improvements: S.arr(S.str()), missingConcepts: S.arr(S.str()), mathIssues: S.arr(S.str('Mathematical inaccuracies, if any')) }), maxTokens: 3000, effort: 'low',
      });
    } catch { /* heuristic feedback still stands */ }
  }
  const id = randomUUID();
  run('INSERT INTO presentation_sessions (id, profile_id, topic_id, topic_title, mode, transcript, duration_s, feedback, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, p.id, topicId, title, mode, transcript, duration, JSON.stringify(fb), fb.overall);
  const xp = awardXp(p.id, 'presentation', `Presentation: ${title}`);
  recordActivity(p.id, duration ?? 60);
  const achievements = checkAchievements(p.id);
  track('presentation', { mode }, prefs(p).analyticsOptOut === true);
  res.json({ id, feedback: fb, xp, achievements });
});

void readFileSync;
