// Fixture: read-only Playwright script — no submit-like clicks.
// Demonstrates the read-variant Plan output (observe + return, no act/key).

import { test } from "@playwright/test";

test("browse trending", async ({ page }) => {
  await page.goto("https://github.com/trending");
  await page.waitForSelector("article.Box-row");
  await page.click("a[href='/trending?since=weekly']");
  await page.waitForTimeout(500);
});
