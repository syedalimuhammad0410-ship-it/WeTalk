// Quick visual check of the location animations (cinematic lock-on, board location cards, map fly-to).
// Usage: BASE=... E2E_EMAIL=... E2E_PASSWORD=... EXAMPLE=street node scripts/geo-e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || "e2e-shots";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: (process.env.CHROME_ARGS || "").split(" ").filter(Boolean) });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("response", async (r) => {
  if (!/\/api\/geolocate/.test(r.url())) return;
  const body = await r.text().catch(() => "");
  log("NET", r.status(), r.url().replace(BASE, ""), body.slice(0, 300));
});
await page.goto(`${BASE}/login`);
await page.fill("input[type=email]", process.env.E2E_EMAIL);
await page.fill("input[type=password]", process.env.E2E_PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL(/\/app$/, { timeout: 20000 });
if (process.env.UPLOAD) {
  // upload a local photo the way a user would, then start
  await page.locator("input[type=file]").first().setInputFiles(process.env.UPLOAD);
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Start Investigation/ }).click();
} else {
  await page.goto(`${BASE}/app?demo=${process.env.EXAMPLE || "street"}`);
}
await page.waitForURL(/\/app\/i\//, { timeout: 60000 });
log("investigation", page.url());
let shot = 0;
const t0 = Date.now();
while (Date.now() - t0 < 8 * 60 * 1000) {
  const body = await page.locator("body").innerText();
  if (/POSSIBLE LOCATION \d\/\d/.test(body) && shot < 3) {
    await page.waitForTimeout(shot === 0 ? 1900 : 2600);
    await page.screenshot({ path: `${OUT}/geo-lock-${shot++}.png` });
    log("lock shot", shot);
  }
  if (/Investigation complete/.test(body)) break;
  await page.waitForTimeout(1500);
}
log("done in", Math.round((Date.now() - t0) / 1000), "s");
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await page.getByRole("tab", { name: /^Result/ }).click();
await page.waitForTimeout(1200);
log("HEADLINE:", await page.locator("h2").first().innerText().catch(() => "?"));
await page.screenshot({ path: `${OUT}/geo-result.png` });
const subj = page.getByRole("tab", { name: /^Subjects/ });
if (await subj.count()) {
  await subj.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/subjects-tab.png` });
}
await page.getByRole("tab", { name: /^Result/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/result-tab.png` });
await page.getByRole("tab", { name: /^Evidence board/ }).click();
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/geo-board.png` });
await page.getByRole("tab", { name: /^Map/ }).click();
await page.waitForTimeout(2500);
const tour = page.getByRole("button", { name: /Tour possible locations/ });
if (await tour.count()) {
  await tour.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/geo-map-lock.png` });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/geo-map-locked.png` });
}
// STEPLOG: what the run did (saved investigation)
const id = page.url().match(/\/app\/i\/([^?]+)/)?.[1];
if (id) {
  const inv = await page.evaluate(async (i) => (await (await fetch(`/api/investigations/${i}`)).json()), id);
  const v = inv.investigation || inv;
  const run = v.runs?.[v.runs.length - 1];
  for (const st of run?.steps || []) if (/geoloc|combination|dossier/.test(st.branch)) log("STEP", st.branch, st.status, (st.label || "").slice(0, 70), "|", (st.detail || "").slice(0, 90));
  for (const d of v.dossiers || []) log("DOSSIER", d.kind, "|", d.name, "|", d.facts.filter((f) => f.group !== "links").slice(0, 9).map((f) => `${f.label}: ${f.value}${f.asOf ? ` (${f.asOf})` : ""}`).join(" ; "), "| news", d.newsIds.length);
  log("IMAGES", (v.candidates || []).slice(0, 3).map((c) => `${c.name}: ${c.images.length} refs (${c.images.filter((i) => /Street-level/.test(i.title)).length} street-level), compared ${c.images.filter((i) => i.comparison).length}`).join(" | "));
}
console.log("ERRORS:", errors.filter((e) => !/favicon|404 \(Not Found\)/.test(e)).slice(0, 20));
await browser.close();
