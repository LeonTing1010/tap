// Fixture: modern Playwright codegen output using locator-chain API.
// Covers all getBy* helpers + .locator() + five action types.

import { test } from "@playwright/test";

test("sign up flow", async ({ page }) => {
  await page.goto("https://example.com/signup");
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("s3cr3t");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByTestId("welcome-banner").waitFor();
  await page.locator(".search-input").fill("hello");
  await page.getByPlaceholder("Search…").type("query");
  await page.getByText("Submit").click();
});
