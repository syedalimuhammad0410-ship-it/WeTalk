import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end UI workflow against a running app + fixture websites
 * (see tests/tools/fixture-server.mjs and docs/TESTING.md).
 * Uses the clearly-labelled email SANDBOX so nothing is delivered.
 */
const stamp = Date.now();
const email = `e2e-${stamp}@example.com`;
const password = "correct-horse-42";
const OUTDATED = process.env.FIXTURE_OUTDATED_URL ?? "http://127.0.0.1:4010";

async function continueStep(page: Page) {
  await page.getByRole("button", { name: /^Continue/ }).click();
}

test.describe.serial("WebScout full workflow", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Dev servers compile routes on first hit; warm them so timing assertions are about the app, not the compiler.
    for (const path of ["/login", "/signup", "/onboarding", "/dashboard", "/leads", "/inbox", "/follow-ups"]) await page.request.get(path).catch(() => {});
  });

  test("sign up and complete onboarding", async () => {
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Alex Tester");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/onboarding/);
    await page.getByLabel("Workspace name").fill(`E2E Studio ${stamp}`);
    await continueStep(page);
    await expect(page.getByRole("heading", { name: "What do you sell?" })).toBeVisible();
    await page.getByLabel("Describe your business").fill("We build fast websites for local service businesses.");
    await page.getByLabel(/Services you offer/).fill("Website design\nWebsite development");
    await continueStep(page);
    await expect(page.getByRole("heading", { name: "Connect your AI provider" })).toBeVisible();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect business discovery" })).toBeVisible();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connect email" })).toBeVisible();
    await page.getByRole("button", { name: /Sandbox/ }).click();
    await page.getByLabel("From address").fill("alex@studio.example");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("alex@studio.example")).toBeVisible();
    await continueStep(page);
    await page.getByLabel("Company name").fill("E2E Studio");
    await page.getByLabel("Sender name").fill("Alex");
    await continueStep(page);
    await expect(page.getByRole("heading", { name: "Outreach tone" })).toBeVisible();
    await page.getByRole("button", { name: "Friendly" }).click();
    await continueStep(page);
    await expect(page.getByRole("heading", { name: "Automation" })).toBeVisible();
    await continueStep(page);
    await expect(page.getByRole("heading", { name: "Test connections" })).toBeVisible();
    await expect(page.getByText("Database")).toBeVisible();
    await continueStep(page);
    await page.getByRole("button", { name: /Add or import leads/ }).click();
    await expect(page).toHaveURL(/\/leads/);
  });

  test("add a business, analyse its website, see explainable scores", async () => {
    await expect(page.getByRole("dialog", { name: "Add a business" })).toBeVisible();
    await page.getByLabel("Business name").fill("ABC Cleaning Services");
    await page.getByLabel("Category").fill("House cleaning service");
    await page.getByLabel("City").fill("Mississauga");
    await page.getByLabel("Website").fill(OUTDATED);
    await page.getByLabel("Business email").fill("owner@abccleaning.example");
    await page.getByLabel(/Where did this email come from/).fill("Listed on their website contact section");
    await page.getByRole("button", { name: "Add business" }).click();
    await expect(page.getByRole("heading", { name: "ABC Cleaning Services" })).toBeVisible();
    await page.getByRole("button", { name: "Analyze website" }).first().click();
    await expect(page.getByText(/Website scored \d+\/100/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("tab", { name: "Website & Audit" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Outdated").first()).toBeVisible();
    await page.getByRole("button", { name: /Mobile/ }).first().click();
    await expect(page.getByText(/viewport/i).first()).toBeVisible();
    await page.getByRole("tab", { name: "Opportunity" }).click();
    await expect(page.getByText(/Opportunity score: \d+\/100/)).toBeVisible();
    await expect(page.getByText("Online quote / estimate request").first()).toBeVisible();
  });

  test("generate, edit and version the website prompt", async () => {
    await page.getByRole("button", { name: "Generate website prompt" }).click();
    await expect(page).toHaveURL(/\/prompts\//, { timeout: 120_000 });
    const editor = page.getByLabel("Website prompt");
    await expect(editor).toContainText("WEBSITE DEVELOPMENT MASTER PROMPT");
    const text = await editor.inputValue();
    expect(text).toContain("ABC Cleaning Services");
    expect(text).toContain("Use verified information only");
    expect(text).toContain("[ADD REAL TESTIMONIAL]");
    expect(text.split(/\s+/).length).toBeGreaterThan(3000);
    await editor.fill(`${text}\n\nNOTE FROM AGENCY: Use the brand's green.`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved as version 2/)).toBeVisible();
    await page.getByRole("button", { name: "Make more concise" }).click();
    await expect(page.getByText(/Version 3 created/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /History/ }).click();
    await expect(page.getByText("Made concise")).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).first().click();
    await expect(page.getByText(/Restored version/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Website prompt")).toContainText("NOTE FROM AGENCY");
  });

  test("generate outreach, confirm and send via sandbox", async () => {
    await page.getByRole("link", { name: "ABC Cleaning Services" }).click();
    await page.getByRole("tab", { name: "Emails" }).click();
    await page.getByRole("button", { name: "Generate email" }).click();
    await expect(page.getByLabel("Subject")).toHaveValue(/ABC Cleaning Services/);
    const body = await page.getByLabel("Message").inputValue();
    expect(body).not.toMatch(/\{\{/);
    await page.getByRole("button", { name: "Review & send" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm and send" });
    await expect(dialog.getByText("owner@abccleaning.example")).toBeVisible();
    await expect(dialog.getByText(/SANDBOX/)).toBeVisible();
    await dialog.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText(/Recorded in sandbox/)).toBeVisible();
    await expect(page.getByText("Initial outreach already sent")).toBeVisible();
    await page.getByRole("tab", { name: /Follow-Ups/ }).click();
    await expect(page.getByText("Follow-up 1").first()).toBeVisible();
  });

  test("reply arrives, is classified in context, follow-ups stop", async () => {
    await page.getByRole("tab", { name: /Conversation/ }).click();
    await page.getByRole("link", { name: /A website idea|ABC Cleaning/ }).first().click();
    await expect(page).toHaveURL(/\/inbox\//);
    await page.getByRole("button", { name: "Simulate reply" }).click();
    await page.getByLabel("Reply text").fill("Hi, thanks for reaching out. We're interested. How much do you charge?");
    const resp = page.waitForResponse((r) => r.url().includes("/simulate"));
    await page.getByRole("button", { name: "Simulate reply", exact: true }).last().click();
    const r = await resp;
    console.log("simulate:", r.status(), await r.text());
    await expect(page.getByText("We're interested").first()).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("Intent").first()).toBeVisible();
      await expect(page.getByText(/Pricing|Interested/).first()).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await page.goto("/follow-ups");
    await page.getByRole("tab", { name: /Stopped/ }).click();
    await expect(page.getByText(/Business replied/).first()).toBeVisible();
  });

  test("unsubscribe reply sets Do Not Contact and blocks outreach", async () => {
    await page.goto("/inbox");
    await page.getByRole("link", { name: /ABC Cleaning Services/ }).first().click();
    await page.getByRole("button", { name: "Simulate reply" }).click();
    await page.getByLabel("Reply text").fill("Please don't contact us again.");
    await page.getByRole("button", { name: "Simulate reply", exact: true }).last().click();
    await expect(async () => {
      await page.reload();
      await expect(page.getByText("Do Not Contact").first()).toBeVisible();
    }).toPass({ timeout: 30_000 });
    await page.goto("/leads");
    await expect(page.getByText("Do not contact").first()).toBeVisible();
  });

  test("dashboard numbers come from the database; dark mode persists", async () => {
    await page.goto("/dashboard");
    await expect(page.getByText("Businesses found")).toBeVisible();
    const card = page.locator("a", { has: page.getByText("Emails sent") });
    await expect(card).toContainText("1");
    await page.getByRole("button", { name: /Theme/ }).click(); // light -> dark (or system->light first)
    await page.getByRole("button", { name: /Theme/ }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.themePref);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.themePref)).toBe(theme);
  });
});
