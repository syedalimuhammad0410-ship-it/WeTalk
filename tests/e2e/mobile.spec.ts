import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["iPhone 13"], defaultBrowserType: "chromium" });

test("mobile layout: bottom nav, drawer, no horizontal scroll", async ({ page, request }) => {
  const H = { Origin: "http://localhost:3000", "Content-Type": "application/json" };
  const email = `m-${Date.now()}@example.com`;
  await page.request.post("/api/auth/signup", { headers: H, data: { name: "Mo Bile", email, password: "correct-horse-42" } });
  await page.request.post("/api/workspaces", { headers: H, data: { name: "Mobile WS" } });
  await page.request.patch("/api/workspace", { headers: H, data: { onboardingCompleted: true } });
  const lead = await (await page.request.post("/api/leads", { headers: H, data: { name: "Tiny Bakery With A Very Long Business Name That Wraps", category: "Bakery", city: "Toronto" } })).json();
  void request;
  for (const path of ["/dashboard", "/leads", `/leads/${lead.id}`, "/inbox", "/settings/compliance", "/analytics"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Primary mobile" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("link", { name: "Templates" }).click();
  await expect(page).toHaveURL(/templates/);
});
