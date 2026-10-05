// Visits every app page with a session cookie and reports HTTP/console errors.
import { chromium } from "@playwright/test";
const [,, token, ...paths] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addCookies([{ name: "ws_session", value: token, url: "http://localhost:3000" }]);
const p = await ctx.newPage();
let bad = 0;
for (const path of paths) {
  const errs = [];
  const onC = (m) => m.type() === "error" && !/favicon|DevTools/.test(m.text()) && errs.push(m.text().slice(0, 160));
  const onE = (e) => errs.push(e.message.slice(0, 160));
  p.on("console", onC); p.on("pageerror", onE);
  const r = await p.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(300);
  p.off("console", onC); p.off("pageerror", onE);
  const status = r?.status();
  if (status !== 200 || errs.length) bad++;
  console.log(`${status} ${path}${errs.length ? `  ERR: ${errs.join(" | ")}` : ""}`);
}
await b.close();
process.exit(bad ? 1 : 0);
