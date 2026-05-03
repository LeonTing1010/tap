/**
 * Semantic conversion tests — input .ts fixture → expected v2 Plan.
 *
 * Per ADR 2026-05-04 ecosystem v2 launch, output is a bare Plan
 * (discriminated union) — not a TapAnnotation envelope.
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

test("playwrightToTap converts fixture sources to expected v2 Plan", async () => {
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

    const { plan } = mod.playwrightToTap(source, {
      site: expected.id.site,
      name: expected.id.name,
    });

    assert.deepStrictEqual(
      plan,
      expected,
      `${basename(inputName)} → produced Plan does not match ${expectedName}`,
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
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.waitForTimeout(1500);\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe, [
    { op: "nav", url: "https://x" },
    { op: "wait", ms: 1500 },
  ]);
});

test("playwrightToTap permissive mode emits op:eval for unsupported page.* call", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan, warnings } = playwrightToTap(
    `await page.goto("https://x");\nawait page.hover('.btn');\n`,
    { site: "x", name: "y" },
  );
  assert.equal(plan.observe[0].op, "nav");
  assert.equal(plan.observe[1].op, "eval");
  assert.equal(plan.observe[1].returns.type, "object");
  assert.ok(warnings.some((w) => w.kind === "eval-fallback"));
});

test("playwrightToTap maps page.evaluate to op:eval with returns.type", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan, warnings } = playwrightToTap(
    `await page.goto("https://x");\nawait page.evaluate(() => document.title);\n`,
    { site: "x", name: "y" },
  );
  assert.equal(plan.observe[1].op, "eval");
  assert.equal(plan.observe[1].returns.type, "object");
  assert.ok(warnings.some((w) => w.kind === "eval-fallback"));
});

test("playwrightToTap maps page.context().cookies() to op:cookies", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nconst c = await page.context().cookies();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "cookies" });
});

test("playwrightToTap drops page.screenshot() with warning", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan, warnings } = playwrightToTap(
    `await page.goto("https://x");\nawait page.screenshot({ path: "x.png" });\n`,
    { site: "x", name: "y" },
  );
  assert.equal(plan.observe.length, 1);
  assert.equal(plan.observe[0].op, "nav");
  assert.ok(warnings.some((w) => w.kind === "screenshot-dropped"));
});

test("playwrightToTap strict mode throws on unsupported page.* call", async () => {
  const { playwrightToTap, PlaywrightConversionError } = await import(DIST);
  assert.throws(
    () =>
      playwrightToTap(
        `await page.goto("https://x");\nawait page.hover('.btn');\n`,
        { site: "x", name: "y", strict: true },
      ),
    (err) =>
      err instanceof PlaywrightConversionError &&
      /Unsupported Playwright API/.test(err.message),
  );
});

// ── Read vs write variant ────────────────────────────────────────────────────

test("read variant: no submit-like click → observe + no act/key", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.click('.read-link');\n`,
    { site: "x", name: "y" },
  );
  assert.ok(plan.observe);
  assert.equal(plan.act, undefined);
  assert.equal(plan.key, undefined);
});

test("write variant: submit-like click → act + placeholder key + warning", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan, warnings } = playwrightToTap(
    `await page.goto("https://x");\nawait page.click('button[type="submit"]');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe, []);
  assert.ok(plan.act);
  assert.equal(plan.key, "TODO_DECLARE_KEY");
  assert.ok(warnings.some((w) => w.kind === "todo-key"));
});

test("variant override forces write even without submit-like click", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.click('.read-link');\n`,
    { site: "x", name: "y", variant: "write" },
  );
  assert.ok(plan.act);
  assert.equal(plan.key, "TODO_DECLARE_KEY");
});

// ── Locator chain ────────────────────────────────────────────────────────────

test("locator chain: .locator(sel).click() → input/click", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('.btn').click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "click", target: ".btn" });
});

test("locator chain: .locator(sel).fill(val) → input/fill", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('#email').fill('a@b.com');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "fill", target: "#email", value: "a@b.com" });
});

test("locator chain: .getByTestId(id).waitFor() → wait/selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByTestId('banner').waitFor();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "wait", selector: '[data-testid="banner"]' });
});

test("locator chain: .getByRole(role, {name}).click() → input/click with role selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByRole('link', { name: 'Docs' }).click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "click", target: 'role=link[name="Docs"]' });
});

test("locator chain: .getByLabel(label).fill(val) → label= selector", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByLabel('Email').fill('u@x.com');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "fill", target: "label=Email", value: "u@x.com" });
});

test("locator chain: .getByText(text).click() → text= selector (read variant)", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByText('Docs').click();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "click", target: "text=Docs" });
});

test("locator chain: .getByPlaceholder(ph).type(val) → placeholder= selector + type op", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan } = playwrightToTap(
    `await page.goto("https://x");\nawait page.getByPlaceholder('Search').type('query');\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(plan.observe[1], { op: "input", kind: "type", target: "placeholder=Search", value: "query" });
});

test("locator chain: unrecognised action falls through to op:eval in permissive mode", async () => {
  const { playwrightToTap } = await import(DIST);
  const { plan, warnings } = playwrightToTap(
    `await page.goto("https://x");\nawait page.locator('.btn').hover();\n`,
    { site: "x", name: "y" },
  );
  assert.equal(plan.observe[1].op, "eval");
  assert.ok(warnings.some((w) => w.kind === "eval-fallback"));
});
