/**
 * Semantic conversion tests — input .ts fixture → expected .tap.json.
 *
 * Run via `npm test` after `npm run build`. Uses the Node 20+ built-in
 * test runner (no extra dev dep).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const DIST = resolve(__dirname, "..", "dist", "index.js");

test("playwrightToTap converts fixture sources to expected .tap.json", async () => {
  const mod = await import(DIST);
  const entries = await readdir(FIXTURES);
  const inputs = entries.filter(
    (n) => (n.endsWith(".ts") || n.endsWith(".js")) &&
      !n.endsWith(".expected.json"),
  );
  assert.ok(inputs.length > 0, "fixture corpus must be non-empty");

  for (const inputName of inputs) {
    const stem = inputName.replace(/\.[tj]s$/, "");
    const expectedName = `${stem}.expected.json`;
    if (!entries.includes(expectedName)) {
      throw new Error(`fixture ${inputName} has no matching ${expectedName}`);
    }
    const source = await readFile(resolve(FIXTURES, inputName), "utf8");
    const expected = JSON.parse(
      await readFile(resolve(FIXTURES, expectedName), "utf8"),
    );

    // Derive site/name from the fixture filename for stability.
    // simple-goto-click.ts → site = "github" (from expected) — we cheat by
    // reading the expected and using its body.site/name as the input
    // options. The fixture pair captures the expected end-state, including
    // metadata, not just ops.
    const got = mod.playwrightToTap(source, {
      site: expected.body.site,
      name: expected.body.name,
      intent: expected.body.intent,
    });

    assert.deepStrictEqual(
      got,
      expected,
      `${basename(inputName)} → produced TapAnnotation does not match ${expectedName}`,
    );
  }
});

test("playwrightToTap throws on empty source", async () => {
  const { playwrightToTap, PlaywrightConversionError } = await import(DIST);
  assert.throws(
    () => playwrightToTap("// just a comment\n", { site: "x", name: "y" }),
    (err) =>
      err instanceof PlaywrightConversionError &&
      /no Playwright API calls detected/.test(err.message),
  );
});

test("playwrightToTap requires site and name", async () => {
  const { playwrightToTap, PlaywrightConversionError } = await import(DIST);
  assert.throws(
    () => playwrightToTap("await page.goto('https://x');", { site: "", name: "y" }),
    (err) =>
      err instanceof PlaywrightConversionError &&
      /required/i.test(err.message),
  );
});

test("playwrightToTap converts page.waitForTimeout into wait op (ms)", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.waitForTimeout(1500);\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops, [
    { op: "nav", url: "https://x" },
    { op: "wait", ms: 1500 },
  ]);
});

test("playwrightToTap permissive mode emits exec for unsupported page.* call", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.evaluate(() => window.scrollTo(0, 1000));\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.body.ops[0].op, "nav");
  assert.equal(got.body.ops[1].op, "exec");
  assert.equal(got.body.allowUnverifiable, true);
});

test("playwrightToTap strict mode throws on unsupported page.* call", async () => {
  const { playwrightToTap, PlaywrightConversionError } = await import(DIST);
  assert.throws(
    () =>
      playwrightToTap(
        `await page.goto("https://x");\nawait page.evaluate(() => 1);\n`,
        { site: "x", name: "y", strict: true },
      ),
    (err) =>
      err instanceof PlaywrightConversionError &&
      /Unsupported Playwright API/.test(err.message),
  );
});

// ── Locator chain (0.2) ──────────────────────────────────────────────────────

test("locator chain: .locator(sel).click() → input/click", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('.btn').click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "click", target: ".btn" });
});

test("locator chain: .locator(sel).fill(val) → input/fill", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('#email').fill('a@b.com');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "fill", target: "#email", value: "a@b.com" });
});

test("locator chain: .getByTestId(id).waitFor() → wait/selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByTestId('banner').waitFor();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "wait", selector: '[data-testid="banner"]' });
});

test("locator chain: .getByRole(role, {name}).click() → input/click with role selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByRole('button', { name: 'Submit' }).click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "click", target: 'role=button[name="Submit"]' });
});

test("locator chain: .getByLabel(label).fill(val) → label= selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByLabel('Email').fill('u@x.com');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "fill", target: "label=Email", value: "u@x.com" });
});

test("locator chain: .getByText(text).click() → text= selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByText('Submit').click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "click", target: "text=Submit" });
});

test("locator chain: .getByPlaceholder(ph).type(val) → placeholder= selector + type op", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByPlaceholder('Search').type('query');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "type", target: "placeholder=Search", value: "query" });
});

test("locator chain: unrecognised action falls through to exec in permissive mode", async () => {
  const { playwrightToTap } = await import(DIST);
  const got = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('.btn').hover();\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.body.ops[1].op, "exec");
  assert.equal(got.body.allowUnverifiable, true);
});
