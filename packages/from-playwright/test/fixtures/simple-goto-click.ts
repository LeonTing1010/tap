// Fixture: smallest meaningful Playwright script.
// Expected mapping:
//   page.goto(url)           → { op: "nav", url }
//   page.click(selector)     → { op: "input", kind: "click", target: selector }
//   page.fill(s, v)          → { op: "input", kind: "fill", target: s, value: v }

import { test, expect } from "@playwright/test";

test("search github", async ({ page }) => {
  await page.goto("https://github.com");
  await page.fill("input[name='q']", "tap automation");
  await page.click("button[type='submit']");
});
