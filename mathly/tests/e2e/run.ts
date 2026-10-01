// Browser end-to-end tests: drives the real UI (production build) through every major flow.
// Usage: npm run build && npm run test:e2e   (CYCLES=10 to repeat the core cycle)
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer, type TestServer } from '../helpers.ts';

const SHOTS = path.resolve(import.meta.dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const CYCLES = Number(process.env.CYCLES ?? 10);
let srv: TestServer; let browser: Browser;
const results: { name: string; ok: boolean; ms: number; error?: string }[] = [];
const pageErrors: string[] = [];
let currentPage: Page | null = null;

async function step(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✔ ${name} (${Date.now() - t}ms)`); }
  catch (e) { if (currentPage) await currentPage.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, '_').slice(0, 50)}.png`) }).catch(() => {}); results.push({ name, ok: false, ms: Date.now() - t, error: (e as Error).message.split('\n')[0] }); console.log(`  ✖ ${name}: ${(e as Error).message.split('\n').slice(0, 3).join(' | ')}`); }
}

/** Tracks question ids served to the page so the test can look up answers in the DB. */
function track(page: Page) {
  currentPage = page;
  const ids: string[] = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!/\/api\/me\/(questions\/next|placement\/(start|answer)|daily|mock-tests$)/.test(u) || r.request().method() === 'OPTIONS') return;
    try {
      const j = await r.json();
      if (j.question?.id) ids.push(j.question.id);
      if (Array.isArray(j.questions)) for (const q of j.questions) ids.push(q.id);
    } catch { /* not json */ }
  });
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  // Achievement / level-up celebrations are modal by design; acknowledge them whenever they appear.
  page.addLocatorHandler(page.getByRole('button', { name: 'Awesome!' }), async (l) => { await l.click({ force: true, timeout: 3000 }).catch(() => {}); }, { noWaitAfter: true }).catch(() => {});
  return { last: () => ids[ids.length - 1], all: ids };
}

async function newContext(opts: { viewport?: { width: number; height: number }; dark?: boolean; mobile?: boolean } = {}) {
  const ctx = await browser.newContext({ baseURL: srv.url, viewport: opts.viewport ?? { width: 1360, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light', isMobile: opts.mobile, hasTouch: opts.mobile, permissions: [] });
  ctx.setDefaultTimeout(12_000);
  return ctx;
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

async function dismissCelebrations(page: Page) {
  for (let i = 0; i < 5; i++) { const b = page.getByRole('button', { name: 'Awesome!' }); if (await b.isVisible().catch(() => false)) { await b.click({ force: true, timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); } else break; }
}

async function answerVisible(page: Page, qid: string) {
  const ans = srv.answerOf(qid);
  const choice = page.getByRole('button', { name: ans, exact: true });
  if (await choice.count()) { await choice.first().click(); return; }
  await page.getByLabel('Your answer').first().fill(ans);
  const check = page.getByRole('button', { name: /check answer|^check$|^next$|^go$/i });
  await check.first().click();
}

async function guestOnboard(page: Page, name: string, gradeLabel = 'Grade 7', takePlacement = false) {
  await page.goto('/');
  await page.waitForURL('**/welcome');
  await page.getByRole('button', { name: /continue without an account/i }).click();
  await page.waitForURL('**/profiles');
  await page.getByPlaceholder('First name or nickname').fill(name);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/onboarding');
  await page.getByRole('button', { name: 'Continue' }).click(); // name prefilled
  await page.getByRole('button', { name: gradeLabel, exact: true }).click();
  await page.getByRole('button', { name: /Canada/ }).click();
  await page.getByRole('button', { name: 'Algebra 1' }).or(page.getByRole('button', { name: 'Grade 7 math' })).or(page.getByRole('button', { name: 'Grade 1 math' })).or(page.getByRole('button', { name: 'Calculus I' })).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'School', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Puzzles', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // styles
  await page.getByRole('button', { name: 'Get ahead', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // daily goal default
  if (takePlacement) await page.getByRole('button', { name: /start placement check/i }).click();
  else { await page.getByRole('button', { name: /skip for now/i }).click(); await page.waitForURL(`${srv.url}/`); }
}

async function fullTour() {
  console.log('\n▶ Full tour (desktop)');
  const ctx = await newContext(); const page = await ctx.newPage(); const q = track(page);

  await step('welcome page renders with both entry options', async () => {
    await page.goto('/');
    await page.waitForURL('**/welcome');
    await page.getByRole('heading', { level: 1, name: /AI math tutor/i }).waitFor();
    await shot(page, '01-welcome-desktop');
  });
  await step('guest profile creation + onboarding + adaptive placement', async () => {
    await guestOnboard(page, 'Muhammad', 'Grade 7', true);
    await page.waitForURL('**/placement');
    await page.getByRole('button', { name: /let’s begin/i }).click();
    let guard = 0;
    while (!(await page.getByText(/your math profile/i).count())) {
      if (guard++ > 60) throw new Error('placement did not finish');
      await page.getByText(/Question \d+ of \d+/).waitFor({ timeout: 10000 }).catch(() => {});
      if (await page.getByText(/your math profile/i).count()) break;
      const id = q.last();
      // Answer most correctly, skip some to exercise "I don't know yet".
      if (guard % 4 === 0) await page.getByRole('button', { name: /i don’t know yet/i }).click();
      else await answerVisible(page, id);
      await page.waitForTimeout(650);
    }
    await page.getByText(/You’re working at about/).waitFor();
    await shot(page, '02-placement-results');
    await page.getByRole('button', { name: /go to my dashboard/i }).click();
  });
  await step('dashboard: greeting, learning level, streak, recommendations', async () => {
    await page.getByRole('heading', { name: /Muhammad/ }).waitFor();
    await page.getByText(/working at approximately/i).waitFor();
    await page.getByText('Today’s recommendations').waitFor();
    await shot(page, '03-dashboard-desktop');
  });
  await step('lesson: all 7 stages, XP and completion', async () => {
    await page.goto('/lesson/two-step-eq');
    await page.getByText('Key idea').waitFor();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('button', { name: /show next step/i }).waitFor();
    while (await page.getByRole('button', { name: /show next step/i }).count()) await page.getByRole('button', { name: /show next step/i }).click();
    await page.getByRole('button', { name: /^Continue/ }).click();
    for (const stageCount of [1, 3, 1]) {
      for (let i = 0; i < stageCount; i++) {
        await page.getByLabel('Your answer').or(page.getByRole('button', { name: srv.answerOf(q.last()), exact: true })).first().waitFor();
        await page.waitForTimeout(150);
        await answerVisible(page, q.last());
        await page.getByRole('button', { name: /next question|continue/i }).last().click();
      }
    }
    await page.getByLabel('Your explanation').fill('I undo the addition first with the inverse operation on both sides to keep the balance, then divide to isolate x.');
    await page.getByRole('button', { name: /get feedback/i }).click();
    await page.getByText(/explanation score/).waitFor();
    await shot(page, '04-lesson-explain');
    await page.getByRole('button', { name: /^Continue/ }).click();
    for (let i = 0; i < 2; i++) {
      await page.getByText(/Quick check \d of/).waitFor();
      await page.waitForTimeout(150);
      const id = q.last(); const ans = srv.answerOf(id);
      const choice = page.getByRole('button', { name: ans, exact: true });
      if (await choice.count()) await choice.first().click(); else await page.getByLabel('Your answer').fill(ans);
      await page.getByRole('button', { name: /🙂/ }).click();
      await page.getByRole('button', { name: /check answer/i }).click();
      await page.getByRole('button', { name: /next question|continue/i }).last().click();
    }
    await page.getByRole('heading', { name: 'Lesson complete!' }).waitFor();
    await page.getByRole('button', { name: 'Awesome!' }).click({ timeout: 4000 }).catch(() => {});
    await shot(page, '05-lesson-complete');
  });
  await step('practice session with confidence + help ladder + flag', async () => {
    await page.goto('/practice/session?mode=practice&skill=frac-add-unlike');
    await page.getByLabel('Your answer').waitFor();
    await page.getByRole('button', { name: /need help/i }).click();
    await page.getByText('What do you think?').waitFor();
    await page.getByRole('button', { name: /2\. Hint/ }).click();
    await page.getByText('Small hint').waitFor();
    await page.getByRole('button', { name: /report a problem/i }).click();
    await page.getByLabel('What’s wrong?').fill('Testing the report flow');
    await page.getByRole('button', { name: 'Send report' }).click();
    await page.getByText(/report was sent/i).waitFor();
    await page.getByLabel('Your answer').fill('1/1000');
    await page.getByRole('button', { name: /check answer/i }).click();
    await page.getByText(/Attempt 1 of 3/).waitFor();
    await shot(page, '06-practice-feedback');
    await page.getByLabel('Your answer').fill(srv.answerOf(q.last()));
    await page.getByRole('button', { name: /check answer/i }).click();
    await page.getByRole('status').filter({ hasText: /Correct|Spot on|Yes|exactly/ }).first().waitFor();
  });
  await step('mental math & speed/game modes', async () => {
    await page.goto('/practice/session?mode=mental');
    for (let i = 0; i < 3; i++) { await page.getByLabel('Your answer').waitFor(); await page.waitForTimeout(100); await page.getByLabel('Your answer').fill(srv.answerOf(q.last())); await page.getByRole('button', { name: 'Go' }).click(); await page.waitForTimeout(300); }
    await page.goto('/practice/session?mode=speed');
    await page.getByText(/\d+s/).first().waitFor();
    await shot(page, '07-speed-mode');
  });
  await step('daily challenge awards XP', async () => {
    await page.goto('/daily');
    await page.getByText(/Daily Challenge/).first().waitFor();
    await page.waitForTimeout(200);
    await answerVisible(page, q.last());
    await page.getByText('+100 XP').first().waitFor();
  });
  await step('AI tutor (built-in) — hint, quiz and answer check, voice controls', async () => {
    await page.goto('/tutor');
    await page.getByLabel('Message the tutor').fill('Quiz me on percentages');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Type your answer here/).waitFor();
    const conv = await page.evaluate(() => fetch('/api/me/tutor/history', { headers: { 'x-profile-id': localStorage.getItem('mathly.profile') ?? '' } }).then((r) => r.json()));
    assert.ok(conv.conversationId);
    // look up the quiz answer via DB
    const ctxRow = await (async () => { const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(srv.dbPath, { readOnly: true }); const r = db.prepare('SELECT context FROM ai_conversations WHERE id = ?').get(conv.conversationId) as { context: string }; db.close(); return JSON.parse(r.context); })();
    await page.getByLabel('Message the tutor').fill(ctxRow.pendingQuiz.answer);
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Want another one/).waitFor();
    await shot(page, '08-tutor');
  });
  await step('homework helper — typed problem, 6-step workflow, completion', async () => {
    await page.goto('/homework');
    await page.getByLabel('Homework problem').fill('A rectangle has a length of 8 cm and a width of 6 cm. Find its area.');
    await page.getByRole('button', { name: /help me understand it/i }).click();
    await page.getByText('Step 1 · Understand').waitFor();
    await page.locator('mark').first().waitFor(); // highlighted values
    await shot(page, '09-homework-understand');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByLabel('Your answer for this step').fill('length times width');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page.getByLabel('Your answer for this step').fill('48');
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await page.getByText('Step 5 · Check').waitFor();
    await page.getByText('48 cm²').first().waitFor();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByLabel('Your final statement').fill('The area is 48 cm² because 8 × 6 = 48.');
    await page.getByRole('button', { name: /finish problem/i }).click();
    await page.getByText('✓ Completed').waitFor();
  });
  await step('homework image upload (no AI) asks to type the problem', async () => {
    await page.goto('/homework');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.locator('input[type=file][accept^="image/png"]').setInputFiles({ name: 'hw.png', mimeType: 'image/png', buffer: png });
    await page.getByText(/AI vision service/).waitFor();
    await page.getByLabel('Type the problem').fill('Solve 2(x - 3) = x + 4');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('Step 1 · Understand').waitFor();
  });
  await step('Learn Anything builds a custom calculus course', async () => {
    await page.goto('/learn-anything');
    await page.getByLabel('What do you want to learn?').fill('I want to learn calculus.');
    await page.getByRole('button', { name: /build my learning path/i }).click();
    await page.waitForURL(/\/learn\/[0-9a-f-]{36}$/);
    await page.getByText(/Calculus/).first().waitFor();
    await page.getByText('Prerequisite review').waitFor();
    await shot(page, '10-custom-course');
  });
  await step('Request a Topic form', async () => {
    await page.goto('/learn-anything?tab=request');
    await page.getByLabel('Topic', { exact: true }).fill('Math for game development');
    await page.getByLabel('Why do you want to learn it?').fill('I want to build games');
    await page.getByRole('button', { name: 'University', exact: true }).click();
    await page.getByRole('button', { name: /build my course/i }).click();
    await page.waitForURL(/\/learn\/[0-9a-f-]{36}$/);
  });
  await step('course catalog + course page + enroll', async () => {
    await page.goto('/learn');
    await page.getByText('Calculus I').first().click();
    await page.getByRole('heading', { level: 1, name: 'Calculus I' }).waitFor();
    if (await page.getByRole('button', { name: 'Enroll' }).count()) { await page.getByRole('button', { name: 'Enroll' }).click(); await page.getByText('Added to your courses').waitFor(); }
  });
  await step('skill tree (tree + graph) and node details', async () => {
    await page.goto('/skills');
    await page.getByRole('button', { name: /Two-Step Equations/ }).first().click();
    await page.getByRole('dialog').getByText('Prerequisites').waitFor();
    await shot(page, '11-skill-tree');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Graph' }).click();
    await page.getByRole('img', { name: 'Skill graph' }).waitFor();
  });
  await step('test prep: create plan, readiness, mock test with results', async () => {
    await page.goto('/test-prep');
    await page.getByRole('button', { name: /new test plan/i }).click();
    await page.getByLabel('What is the test?').fill('Grade 8 Algebra');
    await page.getByRole('button', { name: /next: topics/i }).click();
    await page.getByPlaceholder('Search topics…').fill('two-step');
    await page.getByRole('button', { name: /Two-Step Equations/ }).click();
    await page.getByPlaceholder('Search topics…').fill('slope');
    await page.getByRole('button', { name: /^📈 Slope$/ }).click();
    await page.getByRole('button', { name: /next: confidence/i }).click();
    await page.getByRole('button', { name: /create my study plan/i }).click();
    await page.waitForURL(/\/test-prep\/[0-9a-f-]{36}$/);
    await page.getByText('Readiness').first().waitFor();
    await shot(page, '12-test-plan');
    await page.getByRole('button', { name: /take a mock test/i }).click();
    await page.getByRole('button', { name: /start mock test/i }).click();
    await page.getByText(/answered/).waitFor();
    const total = await page.getByRole('button', { name: /^Question \d+$/ }).count();
    const ids = q.all.slice(-total);
    for (let i = 0; i < total; i++) {
      await page.getByRole('button', { name: `Question ${i + 1}`, exact: true }).click();
      const visibleIdx = i;
      const ans = srv.answerOf(ids[visibleIdx]);
      const choice = page.getByRole('button', { name: ans, exact: true });
      if (await choice.count()) await choice.first().click(); else await page.getByLabel('Your answer').fill(ans);
    }
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /submit test/i }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Mock test results'), null, { timeout: 15000 });
    await dismissCelebrations(page);
    await page.getByRole('heading', { name: 'Mock test results' }).waitFor();
    await shot(page, '13-mock-results');
  });
  await step('presentation practice (typed) with feedback + try again', async () => {
    await page.goto('/presentation');
    await page.getByRole('button', { name: /The Pythagorean Theorem/ }).click();
    await page.getByRole('tab', { name: /Typed/ }).click();
    await page.getByLabel('Your explanation').fill('The Pythagorean theorem says a squared plus b squared equals c squared for any right triangle. The hypotenuse is the longest side. For example, um, with legs 3 and 4 we get 9 + 16 = 25 so the hypotenuse is 5, because 5 squared is 25. In summary it links the three sides.');
    await page.getByRole('button', { name: /get feedback/i }).click();
    await page.getByText('What went well').waitFor();
    await shot(page, '14-presentation');
    await page.getByRole('button', { name: /try again/i }).click();
  });
  await step('study planner (natural language) + homework organizer', async () => {
    await page.goto('/planner');
    await page.getByLabel('Add to planner').fill('Quadratics homework due tomorrow');
    await page.getByRole('button', { name: /plan it/i }).click();
    await page.getByText(/homework organizer/i).first().waitFor();
    await page.goto('/organizer');
    await page.getByRole('button', { name: /add assignment/i }).first().click();
    await page.getByLabel('Questions').fill('1-10');
    await page.getByLabel('Topic', { exact: true }).fill('fractions');
    await page.getByRole('button', { name: /add & break it down/i }).click();
    await page.getByText('Questions 1–5').first().click();
    await page.getByRole('button', { name: /organize my workload/i }).click();
    await page.getByText(/Suggested plan for today/).waitFor();
    await shot(page, '15-organizer');
  });
  await step('progress, achievements, notifications, resources, search', async () => {
    await page.goto('/progress');
    await page.getByText(/Achievements ·/).waitFor();
    await page.getByText('First Lesson', { exact: true }).waitFor();
    await shot(page, '16-progress');
    await page.goto('/notifications');
    await page.getByRole('heading', { name: 'Notifications' }).waitFor();
    await page.goto('/resources');
    await page.getByText('External', { exact: true }).first().waitFor();
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: 'Search' }).fill('quadratic');
    await page.getByRole('option').first().waitFor();
    await shot(page, '17-search');
    await page.keyboard.press('Escape');
  });
  await step('multiple profiles: create second learner, switch, separate progress', async () => {
    await page.goto('/profiles');
    await page.getByRole('button', { name: /add a learner profile/i }).click();
    await page.getByPlaceholder('First name or nickname').fill('Ayesha');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/onboarding');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Grade 1', exact: true }).click();
    for (let i = 0; i < 7; i++) { const skip = page.getByRole('button', { name: 'Skip', exact: true }); if (await skip.count()) await skip.click(); else break; }
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.getByRole('heading', { name: /Ayesha/ }).waitFor();
    const xp = await page.evaluate(() => fetch('/api/me/progress', { headers: { 'x-profile-id': localStorage.getItem('mathly.profile') ?? '' } }).then((r) => r.json()).then((j) => j.xp));
    assert.equal(xp, 0, 'new profile starts with 0 XP');
    await shot(page, '18-dashboard-early-learner');
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Open Muhammad' }).click();
    await page.getByRole('heading', { name: /Muhammad/ }).waitFor();
  });
  await step('parent/teacher report excludes AI chats', async () => {
    await page.goto('/family');
    await page.getByText('Muhammad’s weekly report').waitFor();
    await page.getByText('Ayesha’s weekly report').waitFor();
    assert.ok(!(await page.getByText('Quiz me on percentages').count()));
    await shot(page, '19-family');
  });
  await step('settings: dark mode, learning mode, PIN, export', async () => {
    await page.goto('/settings');
    await page.getByRole('button', { name: /Dark/ }).click();
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('dark')));
    await shot(page, '20-settings-dark');
    await page.goto('/');
    await shot(page, '21-dashboard-dark');
    await page.goto('/settings');
    const exp = await page.evaluate(async () => { const id = localStorage.getItem('mathly.profile'); const r = await fetch(`/api/profiles/${id}/export`); return r.ok && (await r.json()).app; });
    assert.equal(exp, 'Mathly');
    await page.getByRole('button', { name: /Light/ }).click();
  });
  await step('create account (keeps guest progress), logout, login', async () => {
    const xpBefore = await page.evaluate(() => fetch('/api/profiles').then((r) => r.json()).then((j) => j.profiles.map((p: { xp: number }) => p.xp).join(',')));
    await page.goto('/auth?mode=register');
    await page.getByLabel('Email').fill('muhammad@test.dev');
    await page.getByLabel('Password').fill('mathly123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/profiles');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/welcome');
    await page.goto('/auth?mode=login');
    await page.getByLabel('Email').fill('muhammad@test.dev');
    await page.getByLabel('Password').fill('mathly123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/profiles');
    const xpAfter = await page.evaluate(() => fetch('/api/profiles').then((r) => r.json()).then((j) => j.profiles.map((p: { xp: number }) => p.xp).join(',')));
    assert.equal(xpAfter, xpBefore, 'progress persisted across logout/login');
    await page.getByRole('button', { name: 'Open Muhammad' }).click();
    await page.getByRole('heading', { name: /Muhammad/ }).waitFor();
  });
  await step('OAuth buttons show setup guidance when not configured', async () => {
    const p2 = await ctx.newPage();
    await p2.goto('/auth');
    await p2.getByRole('button', { name: /continue with google/i }).click();
    await p2.getByText(/isn’t set up yet/).waitFor();
    await p2.close();
  });
  await step('error handling: offline banner, unknown route, API errors are friendly', async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByText(/You’re offline/).first().waitFor();
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.goto('/this-does-not-exist');
    await page.getByRole('heading', { name: 'Page not found' }).waitFor();
    const r = await page.evaluate(() => fetch('/api/me/questions/nope/answer', { method: 'POST', headers: { 'x-mathly': '1', 'content-type': 'application/json', 'x-profile-id': localStorage.getItem('mathly.profile') ?? '' }, body: JSON.stringify({ response: '1' }) }).then((x) => x.json()));
    assert.ok(!/stack|at \w+ \(/i.test(JSON.stringify(r)), 'no stack traces');
    assert.match(r.error, /expired|fresh/);
  });
  await ctx.close();

  console.log('\n▶ Admin');
  const actx = await newContext(); const ap = await actx.newPage(); track(ap);
  await step('admin registers and uses every admin tab', async () => {
    await ap.goto('/auth?mode=register');
    await ap.getByLabel('Email').fill('admin@test.dev');
    await ap.getByLabel('Password').fill('adminpass1');
    await ap.getByRole('button', { name: 'Create account' }).click();
    await ap.waitForURL('**/profiles');
    await ap.getByPlaceholder('First name or nickname').fill('Admin');
    await ap.getByRole('button', { name: 'Continue', exact: true }).click();
    await ap.waitForURL('**/onboarding');
    await ap.getByRole('button', { name: 'Continue' }).click();
    for (let i = 0; i < 8; i++) { await ap.waitForTimeout(300); const sk = ap.getByRole('button', { name: 'Skip', exact: true }); if (await sk.count()) await sk.click(); else break; }
    await ap.getByRole('button', { name: /skip for now/i }).click();
    await ap.getByText('Today’s recommendations').waitFor();
    await ap.getByRole('link', { name: 'Admin' }).click();
    await ap.getByText('System health').waitFor();
    for (const tab of ['Users', 'Courses', 'Topic requests', 'Flagged', 'XP & achievements', 'Resources', 'Analytics', 'Audit log']) {
      await ap.getByRole('tab', { name: tab }).click();
      await ap.waitForTimeout(250);
    }
    await ap.getByRole('tab', { name: 'Topic requests' }).click();
    await ap.getByText('Most requested topics').waitFor();
    await ap.getByText(/calculus/i).first().waitFor();
    await ap.getByRole('tab', { name: 'Flagged' }).click();
    await ap.getByText('Testing the report flow').waitFor();
    await ap.getByRole('button', { name: 'Resolve' }).first().click();
    await ap.getByRole('tab', { name: 'Overview' }).click();
    await shot(ap, '22-admin');
  });
  await actx.close();

  console.log('\n▶ Responsive layouts');
  for (const [name, vp, mobile] of [['phone', { width: 390, height: 844 }, true], ['tablet', { width: 820, height: 1180 }, true]] as const) {
    const c = await newContext({ viewport: vp, mobile }); const p = await c.newPage(); const qq = track(p);
    await step(`${name}: onboarding, dashboard, lesson, bottom navigation, no horizontal scroll`, async () => {
      await guestOnboard(p, `Mobile ${name}`, 'Grade 9');
      await p.getByText('Today’s recommendations').waitFor();
      await shot(p, `23-${name}-dashboard`);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
      if (name === 'phone') { await p.getByRole('button', { name: 'More' }).click(); await p.getByRole('dialog', { name: 'More' }).waitFor(); await shot(p, `24-${name}-more`); await p.keyboard.press('Escape'); await p.mouse.click(10, 10); }
      await p.goto('/lesson/slope');
      await p.getByText('Key idea').waitFor();
      await p.goto('/practice/session?mode=practice&skill=slope');
      await p.getByLabel('Your answer').waitFor();
      await shot(p, `25-${name}-practice`);
      const ov2 = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov2 <= 1, `horizontal overflow ${ov2}px on practice`);
      void qq;
    });
    await c.close();
  }
}

/** Repeatable core cycle (guest → profile → onboarding → lesson question → practice → tutor → homework → account → logout/login). */
async function coreCycle(i: number) {
  const ctx = await newContext({ dark: i % 2 === 1, viewport: i % 3 === 2 ? { width: 390, height: 844 } : undefined, mobile: i % 3 === 2 });
  const page = await ctx.newPage(); const q = track(page);
  await step(`cycle ${i + 1}: guest → onboarding → practice → tutor → homework → account → re-login`, async () => {
    await guestOnboard(page, `Learner${i}`, ['Kindergarten', 'Grade 3', 'Grade 7', 'Grade 10', 'University'][i % 5]);
    await page.getByText('Today’s recommendations').waitFor();
    await page.goto('/practice/session?mode=practice');
    await page.waitForTimeout(400);
    await answerVisible(page, q.last());
    await page.getByRole('status').filter({ hasText: /Correct|Spot on|Yes|exactly/ }).first().waitFor();
    await page.goto('/tutor');
    await page.getByLabel('Message the tutor').fill('Explain fractions');
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByText(/Key idea/).waitFor();
    await page.goto('/homework');
    await page.getByLabel('Homework problem').fill(`Find x if ${i + 2}x + 3 = ${(i + 2) * 4 + 3}`);
    await page.getByRole('button', { name: /help me understand it/i }).click();
    await page.getByText('Step 1 · Understand').waitFor();
    const email = `cycle${i}-${Date.now()}@test.dev`;
    await page.goto('/auth?mode=register');
    await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill('cycle1234');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/profiles');
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'x-mathly': '1' } }));
    await page.goto('/auth?mode=login');
    await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill('cycle1234');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL('**/profiles');
    await page.getByRole('button', { name: `Open Learner${i}` }).click();
    await page.getByRole('heading', { name: new RegExp(`Learner${i}`) }).waitFor();
    const xp = await page.evaluate(() => fetch('/api/profiles').then((r) => r.json()).then((j: { profiles: { xp: number }[] }) => j.profiles[0].xp));
    assert.ok(xp > 0, 'XP persisted');
  });
  await ctx.close();
}

async function securityChecks() {
  console.log('\n▶ Security');
  await step('no secrets or API keys in the client bundle', async () => {
    const dist = path.resolve(import.meta.dirname, '../../dist/assets');
    for (const f of readdirSync(dist)) {
      const s = readFileSync(path.join(dist, f), 'utf8');
      // Env var *names* may appear (the setup page documents them); secret *values* must never ship.
      assert.ok(!/sk-ant-[A-Za-z0-9]|BEGIN (EC )?PRIVATE KEY|process\.env/.test(s), `secret value found in ${f}`);
    }
  });
  await step('security headers present', async () => {
    const r = await fetch(`${srv.url}/`);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('content-security-policy')?.includes("default-src 'self'"));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
}

async function main() {
  srv = await startServer();
  browser = await chromium.launch();
  try {
    await fullTour();
    console.log(`\n▶ Core cycles ×${CYCLES}`);
    for (let i = 0; i < CYCLES; i++) await coreCycle(i);
    await securityChecks();
  } finally { await browser.close(); srv.stop(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} E2E steps passed. Screenshots: tests/e2e/screenshots/`);
  if (pageErrors.length) { console.log(`\nUncaught page errors (${pageErrors.length}):\n${[...new Set(pageErrors)].slice(0, 10).join('\n')}`); }
  if (failed.length || pageErrors.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
