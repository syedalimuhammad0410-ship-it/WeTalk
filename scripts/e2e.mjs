// End-to-end test: sign-in, example investigation through the live pipeline, tabs, chat, export.
// Usage: BASE=http://localhost:3000 E2E_EMAIL=... E2E_PASSWORD=... node scripts/e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "e2e-shots";
const EX = process.env.EXAMPLE || "basketball";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// In sandboxed CI behind a TLS-intercepting proxy, pass CHROME_ARGS="--ignore-certificate-errors-spki-list=<proxy CA SPKI>" to trust that one CA.
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: (process.env.CHROME_ARGS || "").split(" ").filter(Boolean) });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

// 1. auth gate
await page.goto(`${BASE}/app`);
await page.waitForURL(/\/login/);
log("redirected to login");
await page.fill('input[type=email]', "intruder@example.com");
await page.fill('input[type=password]', "nope");
await page.click('button[type=submit]');
await page.getByRole("alert").waitFor();
log("unauthorized rejected:", await page.getByRole("alert").innerText());
await page.fill('input[type=email]', process.env.E2E_EMAIL);
await page.fill('input[type=password]', process.env.E2E_PASSWORD);
await page.click('button[type=submit]');
await page.getByText(/Welcome Mr Naqvi/).waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/01-welcome.png` });
log("welcome shown");
await page.waitForURL(/\/app$/, { timeout: 15000 });
await page.getByText("Turn an image into an investigation.").waitFor();
await page.screenshot({ path: `${OUT}/02-home.png` });

// 2. example investigation
await page.goto(`${BASE}/app?demo=${EX}`);
await page.waitForURL(/\/app\/i\//, { timeout: 60000 });
log("investigation", page.url());
const shots = [[8000, "03-cine-a"], [25000, "04-cine-b"], [50000, "05-cine-c"]];
for (const [t, n] of shots) {
  await page.waitForTimeout(t === 8000 ? 8000 : t - (shots[shots.indexOf(shots.find((s) => s[0] === t)) - 1]?.[0] || 0));
  await page.screenshot({ path: `${OUT}/${n}.png` });
  log("shot", n, await page.locator("body").innerText().then((x) => x.match(/PHASE \d \/ 8/)?.[0]));
}
const t0 = Date.now();
await page.getByText("Investigation complete").first().waitFor({ timeout: 9 * 60 * 1000 });
log("complete in", Math.round((Date.now() - t0) / 1000) + 50, "s");
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/06-cine-result.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-result.png`, fullPage: false });
const headline = await page.locator("h2").first().innerText();
log("headline:", headline);

for (const [tab, name] of [["Images & clues", "08-image"], ["Evidence board", "09-board"], ["Map", "10-map"], ["Candidates", "11-candidates"], ["Compare", "12-compare"], ["Sources", "13-sources"], ["Timeline", "14-timeline"], ["Queries", "15-queries"], ["Entities", "16-entities"]]) {
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
  await page.waitForTimeout(tab === "Map" || tab === "Evidence board" ? 3500 : 1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  log("tab", tab);
}

// 3. chat
await page.fill('textarea[aria-label="Message TRACE AI"]', "What did you find?");
await page.keyboard.press("Enter");
await page.waitForTimeout(4000);
await page.fill('textarea[aria-label="Message TRACE AI"]', "Why did you reject candidate #3?");
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
await page.fill('textarea[aria-label="Message TRACE AI"]', "Reset");
await page.keyboard.press("Enter");
await page.getByText("Reset current investigation?").waitFor({ timeout: 10000 });
log("reset confirmation shown");
await page.screenshot({ path: `${OUT}/17-chat-reset.png` });
await page.getByRole("button", { name: "Cancel" }).click();

// 4. export
await page.getByRole("button", { name: /Export/ }).first().click();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByText("Markdown").click()]);
const p = `${OUT}/${dl.suggestedFilename()}`;
await dl.saveAs(p);
log("exported", p, fs.statSync(p).size, "bytes");
await page.keyboard.press("Escape");
const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), (await page.getByRole("button", { name: /Export/ }).first().click(), page.getByText("PDF report").click())]);
await pdf.saveAs(`${OUT}/${pdf.suggestedFilename()}`);
log("pdf", pdf.suggestedFilename());

// 5. mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("tab", { name: /^Result/ }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/18-mobile.png` });

console.log("ERRORS:", errors.filter((e) => !/favicon|404 \(Not Found\)/.test(e)).slice(0, 20));
await browser.close();
