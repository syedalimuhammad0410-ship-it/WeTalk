// End-to-end API tests against a real server + database (AI disabled → built-in engines).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, type TestServer } from '../helpers.ts';

let srv: TestServer;
before(async () => { srv = await startServer(); });
after(() => srv?.stop());

type Q = { id: string; skillId: string; answerType: string; choices?: string[] };
async function answerCorrectly(c: Client, q: Q, mode = 'practice') {
  return c.post<{ correct: boolean; xp: number; achievements: { id: string }[] }>(`/me/questions/${q.id}/answer`, { response: srv.answerOf(q.id), mode, timeMs: 4000 });
}
async function newGuestWithProfile(name = 'Muhammad', grade = 7) {
  const c = new Client(srv.url);
  await c.post('/auth/guest');
  const { profile } = await c.post<{ profile: { id: string } }>('/profiles', { name });
  c.profileId = profile.id;
  await c.post('/me/onboarding', { name, schoolGrade: grade, curriculum: 'canada', purposes: ['School'], enjoys: ['Algebra', 'Puzzles'], styles: ['Practice problems'], goals: ['Get ahead'], dailyGoalMin: 25 });
  return c;
}

describe('security', () => {
  test('mutations require the CSRF header', async () => {
    const c = new Client(srv.url);
    const r = await c.req('POST', '/auth/guest', {}, { csrf: false, expect: 403 });
    assert.equal(r._status, 403);
  });
  test('profile data is scoped to its owner', async () => {
    const a = await newGuestWithProfile('A');
    const b = new Client(srv.url); await b.post('/auth/guest');
    b.profileId = a.profileId; // try to use someone else's profile
    await b.get('/me/dashboard', 404);
    await b.get(`/profiles/${a.profileId}/export`, 404);
  });
  test('unauthenticated access is rejected', async () => {
    const c = new Client(srv.url);
    await c.get('/profiles', 401);
    await c.get('/admin/overview', 401);
  });
  test('non-admins cannot use admin APIs', async () => {
    const c = await newGuestWithProfile();
    await c.get('/admin/overview', 403);
  });
  test('malicious math input is not evaluated', async () => {
    const c = await newGuestWithProfile();
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'two-step-eq' });
    const r = await c.post<{ correct: boolean }>(`/me/questions/${question.id}/answer`, { response: 'import("fs")' });
    assert.equal(r.correct, false);
  });
  test('homework uploads are validated by content, not extension', async () => {
    const c = await newGuestWithProfile();
    await c.post('/me/homework', { image: Buffer.from('<script>alert(1)</script>').toString('base64') }, 400);
  });
});

describe('accounts & profiles', () => {
  test('guest upgrade keeps profiles and XP; logout/login restores them', async () => {
    const c = await newGuestWithProfile('Ayesha', 4);
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'mult-facts' });
    const ans = await answerCorrectly(c, question);
    assert.equal(ans.correct, true);
    assert.ok(ans.xp > 0);
    const email = `u${Date.now()}@test.dev`;
    await c.post('/auth/register', { email, password: 'secret123', displayName: 'Parent' });
    const before = await c.get<{ profiles: { id: string; xp: number }[] }>('/profiles');
    assert.equal(before.profiles.length, 1);
    await c.post('/auth/logout');
    await c.get('/profiles', 401);
    await c.post('/auth/login', { email, password: 'wrong-pass1' }, 401);
    await c.post('/auth/login', { email, password: 'secret123' });
    const after = await c.get<{ profiles: { id: string; xp: number }[] }>('/profiles');
    assert.deepEqual(after.profiles.map((p) => [p.id, p.xp]), before.profiles.map((p) => [p.id, p.xp]));
  });
  test('multiple profiles have completely separate progress', async () => {
    const c = await newGuestWithProfile('One', 7);
    const p1 = c.profileId!;
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'two-step-eq' });
    await answerCorrectly(c, question);
    const { profile } = await c.post<{ profile: { id: string } }>('/profiles', { name: 'Two' });
    c.profileId = profile.id;
    await c.post('/me/onboarding', { schoolGrade: 13, curriculum: 'us' });
    const two = await c.get<{ xp: number; totals: { questions: number } }>('/me/progress');
    assert.equal(two.xp, 0); assert.equal(two.totals.questions, 0);
    c.profileId = p1;
    const one = await c.get<{ xp: number; totals: { questions: number } }>('/me/progress');
    assert.ok(one.xp > 0); assert.equal(one.totals.questions, 1);
  });
  test('parental PIN protects deletion; export works; delete account removes everything', async () => {
    const c = await newGuestWithProfile('Kid', 2);
    await c.post(`/profiles/${c.profileId}/pin`, { pin: '1234' });
    await c.del(`/profiles/${c.profileId}`, { pin: '0000' }, 403);
    const ex = await c.get<{ app: string; profile: { name: string; pin_hash?: string } }>(`/profiles/${c.profileId}/export`);
    assert.equal(ex.app, 'Mathly'); assert.equal(ex.profile.name, 'Kid'); assert.equal(ex.profile.pin_hash, undefined);
    await c.del(`/profiles/${c.profileId}`, { pin: '1234' });
    await c.del('/auth/account', { confirm: 'DELETE' });
    await c.get('/profiles', 401);
  });
});

describe('learning engine', () => {
  test('adaptive placement produces a learning profile and estimated mastery', async () => {
    const c = await newGuestWithProfile('Placer', 7);
    let r = await c.post<{ question: Q; done?: boolean; result?: { overall: number; topics: unknown[]; strengths: unknown[]; path: unknown[] } }>('/me/placement/start');
    let n = 0;
    while (!r.done) {
      // Strong student: answers correctly, so the test should place them above grade.
      r = await c.post('/me/placement/answer', { questionId: r.question.id, response: srv.answerOf(r.question.id) });
      if (++n > 60) throw new Error('placement did not finish');
    }
    assert.ok(r.result!.overall >= 7, `expected ≥ grade 7, got ${r.result!.overall}`);
    assert.ok(r.result!.topics.length > 3);
    assert.ok(r.result!.path.length > 0);
    const dash = await c.get<{ profile: { placementDone: boolean; learningLevel: number } }>('/me/dashboard');
    assert.equal(dash.profile.placementDone, true);
    // A weak student: always "I don't know"
    const w = await newGuestWithProfile('Weak', 7);
    let rw = await w.post<{ question: Q; done?: boolean; result?: { overall: number } }>('/me/placement/start');
    while (!rw.done) rw = await w.post('/me/placement/answer', { questionId: rw.question.id, skip: true });
    assert.ok(rw.result!.overall < r.result!.overall, 'weak student placed below strong student');
  });
  test('lesson completion awards XP, achievements and mastery', async () => {
    const c = await newGuestWithProfile('Lessoner', 7);
    for (const stage of ['learn', 'example', 'try', 'practice', 'challenge', 'explain', 'check']) await c.post('/me/lessons/two-step-eq/progress', { stage });
    for (let i = 0; i < 3; i++) { const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'two-step-eq', stage: 'practice', mode: 'lesson' }); await answerCorrectly(c, question, 'lesson'); }
    const ex = await c.post<{ score: number; xp: number }>('/me/explain', { skillId: 'two-step-eq', text: 'I undo the addition first using the inverse operation on both sides, then divide to keep the balance.' });
    assert.ok(ex.score > 40); assert.ok(ex.xp > 0);
    const done = await c.post<{ xp: number; achievements: { id: string }[] }>('/me/lessons/two-step-eq/progress', { stage: 'done', complete: true, score: 100 });
    assert.ok(done.xp >= 150, 'lesson + perfect bonus');
    assert.ok(done.achievements.some((a) => a.id === 'first_lesson'));
    const prog = await c.get<{ skills: { skillId: string; effective: number }[] }>('/me/progress');
    assert.ok(prog.skills.find((s) => s.skillId === 'two-step-eq')!.effective > 30);
  });
  test('wrong answers give gentle targeted feedback, then reveal the solution after 3 tries', async () => {
    const c = await newGuestWithProfile();
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'frac-add-unlike', difficulty: 2 });
    let r: { correct: boolean; feedback: string; solution: unknown } | null = null;
    for (let i = 0; i < 3; i++) r = await c.post(`/me/questions/${question.id}/answer`, { response: '999999' });
    assert.equal(r!.correct, false);
    assert.ok(!/wrong!/i.test(r!.feedback));
    assert.ok(r!.solution, 'solution shown after 3 attempts');
  });
  test('help ladder reveals progressively', async () => {
    const c = await newGuestWithProfile();
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'pythagorean' });
    const kinds = [];
    for (let l = 1; l <= 6; l++) kinds.push((await c.post<{ kind: string }>(`/me/questions/${question.id}/help`, { level: l })).kind);
    assert.deepEqual(kinds, ['think', 'hint', 'concept', 'step', 'example', 'solution']);
    const r = await answerCorrectly(c, question);
    assert.equal(r.correct, true); assert.equal(r.xp, 0, 'no XP after revealing the solution');
  });
  test('all practice modes serve questions; targeted practice and review work', async () => {
    const c = await newGuestWithProfile('Modes', 8);
    for (const mode of ['practice', 'mental', 'puzzle', 'game', 'visual', 'tutor', 'challenge', 'speed', 'realworld', 'review', 'targeted']) {
      const r = await c.post<{ question: Q }>('/me/questions/next', { mode });
      assert.ok(r.question.id, mode);
    }
  });
  test('daily challenge awards XP once', async () => {
    const c = await newGuestWithProfile();
    const d = await c.get<{ question: Q; solved: boolean }>('/me/daily');
    const again = await c.get<{ question: Q }>('/me/daily');
    assert.equal(again.question.id, d.question.id, 'same challenge all day');
    const r = await c.post<{ xp: number }>(`/me/questions/${d.question.id}/answer`, { response: srv.answerOf(d.question.id), mode: 'daily' });
    assert.equal(r.xp, 100);
    const after = await c.get<{ solved: boolean }>('/me/daily');
    assert.equal(after.solved, true);
  });
  test('skill tree, dashboard, recommendations, notifications, search', async () => {
    const c = await newGuestWithProfile('Tree', 7);
    const tree = await c.get<{ nodes: { status: string }[] }>('/me/skills');
    assert.ok(tree.nodes.length > 100);
    assert.ok(tree.nodes.some((n) => n.status === 'recommended'));
    const dash = await c.get<{ recommendations: unknown[]; streak: { current: number } }>('/me/dashboard');
    assert.ok(dash.recommendations.length >= 2);
    const notes = await c.get<{ notifications: { kind: string }[] }>('/me/notifications');
    assert.ok(notes.notifications.some((n) => n.kind === 'daily_goal'));
    const s = await c.get<{ results: { title: string; type: string }[] }>('/me/search?q=quadratic');
    assert.ok(s.results.some((r) => /quadratic/i.test(r.title)));
    assert.ok(s.results.some((r) => r.type === 'Course' || r.type === 'Lesson'));
  });
});

describe('tutor & homework (built-in engines)', () => {
  test('tutor gives hints without the answer, quizzes and checks answers', async () => {
    const c = await newGuestWithProfile('Tutee', 7);
    const { question } = await c.post<{ question: Q }>('/me/questions/next', { skillId: 'two-step-eq' });
    const hint = await c.post<{ reply: string; conversationId: string }>('/me/tutor', { message: 'Give me a hint', context: { questionId: question.id, helpLevel: 2 } });
    assert.ok(hint.reply.length > 10);
    assert.ok(!hint.reply.includes(`x = ${srv.answerOf(question.id)}`), 'hint does not leak the answer');
    const quiz = await c.post<{ reply: string; conversationId: string; quiz: Q }>('/me/tutor', { message: 'Quiz me on fractions' });
    assert.ok(quiz.quiz?.id);
    const check = await c.post<{ reply: string }>('/me/tutor', { message: srv.answerOf(quiz.quiz.id), conversationId: quiz.conversationId });
    assert.match(check.reply, /correct|right|spot on|great/i);
    const solve = await c.post<{ reply: string }>('/me/tutor', { message: 'Solve 3x + 5 = 20' });
    assert.match(solve.reply, /understand/i);
    const hist = await c.get<{ messages: unknown[] }>('/me/tutor/history');
    assert.ok(hist.messages.length >= 2);
  });
  test('homework helper walks the 6-step workflow and verifies the answer', async () => {
    const c = await newGuestWithProfile('HW', 5);
    const { session } = await c.post<{ session: { id: string; analysis: { verified: boolean; tutoring: { steps: unknown[]; finalAnswer: string } } } }>('/me/homework', { text: 'A rectangle has a length of 8 cm and a width of 6 cm. Find its area.' });
    assert.equal(session.analysis.verified, true);
    assert.equal(session.analysis.tutoring.finalAnswer, 'hidden', 'answer hidden until steps are done');
    await c.post(`/me/homework/${session.id}/step`, { answer: 'A = l × w' });
    const s2 = await c.post<{ correct: boolean; session: { analysis: { tutoring: { finalAnswer: string } } } }>(`/me/homework/${session.id}/step`, { answer: '48' });
    assert.equal(s2.correct, true);
    assert.equal(s2.session.analysis.tutoring.finalAnswer, '48 cm²');
    const done = await c.post<{ xp: number }>(`/me/homework/${session.id}/complete`);
    assert.equal(done.xp, 50);
  });
  test('photo upload without AI asks the student to type the problem', async () => {
    const c = await newGuestWithProfile();
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const { session } = await c.post<{ session: { id: string; hasImage: boolean; analysis: { needsText: boolean } } }>('/me/homework', { image: png.toString('base64') });
    assert.equal(session.hasImage, true); assert.equal(session.analysis.needsText, true);
    const upd = await c.patch<{ session: { analysis: { tutoring: { steps: unknown[] } } } }>(`/me/homework/${session.id}`, { text: 'Solve 2(x - 3) = x + 4' });
    assert.ok(upd.session.analysis.tutoring.steps.length >= 2);
  });
});

describe('custom courses, requests, test prep, presentation, planner', () => {
  test('Learn Anything builds a prerequisite-aware calculus path', async () => {
    const c = await newGuestWithProfile('Calc', 11);
    const r = await c.post<{ courseId: string; achievements: { id: string }[] }>('/me/learn-anything', { topic: 'I want to learn calculus.' });
    assert.ok(r.courseId);
    assert.ok(r.achievements.some((a) => a.id === 'course_creator'));
    const course = await c.get<{ course: { units: { id: string; title: string }[]; generatedBy: string } }>(`/me/courses/${r.courseId}`);
    assert.ok(course.course.units.some((u) => u.id === 'prereq-review'), 'weak prerequisites become a review unit');
    assert.ok(course.course.units.some((u) => /calculus/i.test(u.title)));
    const reqs = await c.get<{ requests: { topic: string }[] }>('/me/topic-requests');
    assert.equal(reqs.requests[0].topic, 'I want to learn calculus.');
  });
  test('test prep plan, readiness, mock test, adjustment', async () => {
    const c = await newGuestWithProfile('Tester', 8);
    const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { id } = await c.post<{ id: string }>('/me/tests', { title: 'Grade 8 Algebra', testDate: date, skills: ['two-step-eq', 'slope', 'proportions'], confidence: { slope: 0 } });
    const plan = await c.get<{ test: { plan: { type: string }[] }; readiness: { overall: number; note: string } }>(`/me/tests/${id}`);
    assert.equal(plan.test.plan.length, 6);
    assert.equal(plan.test.plan.at(-1)!.type, 'warmup');
    assert.equal(plan.test.plan.at(-2)!.type, 'mock');
    assert.match(plan.readiness.note, /estimate/i);
    const mock = await c.post<{ id: string; questions: (Q & { format: string })[] }>('/me/mock-tests', { testPlanId: id, count: 6, formats: ['mc', 'short', 'written'] });
    assert.equal(mock.questions.length, 6);
    assert.ok(mock.questions.some((q) => q.answerType === 'choice'));
    const answers = Object.fromEntries(mock.questions.map((q) => [q.id, srv.answerOf(q.id)]));
    const res = await c.post<{ analysis: { score: number; topics: unknown[] }; xp: number }>(`/me/mock-tests/${mock.id}/submit`, { answers, explanations: Object.fromEntries(mock.questions.map((q) => [q.id, 'First I undo the operation because both sides must stay balanced, then I check.'])) });
    assert.ok(res.analysis.score >= 80, `score ${res.analysis.score}`);
    assert.equal(res.xp, 200);
    const after = await c.get<{ readiness: { overall: number } }>(`/me/tests/${id}`);
    assert.ok(after.readiness.overall > plan.readiness.overall);
  });
  test('presentation feedback is behavioral and checks the math', async () => {
    const c = await newGuestWithProfile();
    const r = await c.post<{ feedback: { overall: number; mathErrors: string[]; strengths: string[]; fillerCount: number }; xp: number }>('/me/presentations', {
      topicId: 'pythagorean', mode: 'typed',
      transcript: 'The Pythagorean theorem says a squared plus b squared equals c squared, and it only works for a right triangle. The hypotenuse is the longest side, opposite the right angle. For example, um, with legs 3 and 4, 9 + 16 = 26, so the hypotenuse is 5. In summary, it connects the three sides.',
    });
    assert.ok(r.feedback.mathErrors.length === 1, 'catches 9 + 16 = 26');
    assert.ok(r.feedback.fillerCount >= 1);
    assert.equal(r.xp, 100);
  });
  test('natural-language planner and homework organizer', async () => {
    const c = await newGuestWithProfile();
    const t = await c.post<{ kind: string; id: string }>('/me/planner/parse', { text: 'Math test in 6 days on linear equations' });
    assert.equal(t.kind, 'test');
    const h = await c.post<{ kind: string }>('/me/planner/parse', { text: 'Quadratics homework due tomorrow' });
    assert.equal(h.kind, 'assignment');
    const { id } = await c.post<{ id: string }>('/me/assignments', { title: 'Worksheet', topic: 'fractions', questions: '1-10' });
    const list = await c.get<{ assignments: { id: string; tasks: { label: string }[] }[] }>('/me/assignments');
    const a = list.assignments.find((x) => x.id === id)!;
    assert.ok(a.tasks.some((x) => x.label === 'Questions 1–5') && a.tasks.some((x) => x.label === 'Questions 6–10'));
    const org = await c.get<{ schedule: unknown[] }>('/me/assignments/organize');
    assert.ok(org.schedule.length >= 2);
    const cal = await c.get<{ events: unknown[] }>('/me/planner');
    assert.ok(cal.events.length > 3);
  });
});

describe('admin', () => {
  test('admin can review requests, flags, users, XP rules, resources and analytics', async () => {
    const learner = await newGuestWithProfile('Flagger');
    const { question } = await learner.post<{ question: Q }>('/me/questions/next', { skillId: 'slope' });
    await learner.post('/me/flag', { kind: 'question', ref: question.id, reason: 'I think the answer key is wrong' });
    await learner.post('/me/learn-anything', { topic: 'math for game development' });
    const admin = new Client(srv.url);
    await admin.post('/auth/register', { email: 'admin@test.dev', password: 'adminpass1' });
    const ov = await admin.get<{ counts: { profiles: number } }>('/admin/overview');
    assert.ok(ov.counts.profiles > 0);
    const flags = await admin.get<{ flags: { id: string; snapshot: { prompt: string } }[] }>('/admin/flags');
    assert.ok(flags.flags[0].snapshot.prompt);
    await admin.patch(`/admin/flags/${flags.flags[0].id}`, { status: 'resolved' });
    const reqs = await admin.get<{ top: { topic: string; n: number }[] }>('/admin/topic-requests');
    assert.ok(reqs.top.length > 0);
    await admin.put('/admin/xp-rules', { practice_correct: 12 });
    const rules = await admin.get<{ rules: { practice_correct: number } }>('/admin/xp-rules');
    assert.equal(rules.rules.practice_correct, 12);
    await admin.post('/admin/resources', { title: 'Bad', url: 'javascript:alert(1)', source: 'x' }, 400);
    const users = await admin.get<{ users: { id: string; email: string | null }[] }>('/admin/users');
    const target = users.users.find((u) => u.email === null)!;
    await admin.patch(`/admin/users/${target.id}`, { role: 'admin' }, 403); // only super admins grant admin
    await admin.patch(`/admin/users/${target.id}`, { role: 'moderator' });
    const an = await admin.get<{ byEvent: unknown[] }>('/admin/analytics');
    assert.ok(an.byEvent.length > 0);
    const audit = await admin.get<{ logs: { action: string }[] }>('/admin/audit');
    assert.ok(audit.logs.some((l) => l.action === 'xp_rules.updated'));
    const { id } = await admin.post<{ id: string }>('/admin/courses', { title: 'Admin Course', description: 'Made by admin', units: [{ title: 'U1', skills: ['slope', 'slope-intercept'] }] });
    learner.profileId && (await learner.get(`/me/courses/${id}`));
  });
});
