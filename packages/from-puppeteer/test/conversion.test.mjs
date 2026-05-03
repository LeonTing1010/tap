import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const DIST = resolve(__dirname, "..", "dist", "index.js");

test("puppeteerToTap converts fixture sources to expected v2 Plan", async () => {
  const mod = await import(DIST);
  const entries = await readdir(FIXTURES);
  const inputs = entries.filter(
    (n) =>
      (n.endsWith(".ts") || n.endsWith(".js")) &&
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

    const got = mod.puppeteerToTap(source, {
      site: expected.id.site,
      name: expected.id.name,
      // Let the adapter auto-detect intent; the fixture should be
      // structured to match the auto-detection result.
    });

    assert.deepStrictEqual(
      got,
      expected,
      `${basename(inputName)} → produced v2 Plan does not match ${expectedName}`,
    );
  }
});

test("puppeteerToTap throws on empty source", async () => {
  const { puppeteerToTap, PuppeteerConversionError } = await import(DIST);
  assert.throws(
    () => puppeteerToTap("// just a comment\n", { site: "x", name: "y" }),
    (err) =>
      err instanceof PuppeteerConversionError &&
      /no Puppeteer API calls detected/.test(err.message),
  );
});

test("puppeteerToTap requires site and name", async () => {
  const { puppeteerToTap, PuppeteerConversionError } = await import(DIST);
  assert.throws(
    () => puppeteerToTap("await page.goto('https://x');", { site: "", name: "y" }),
    (err) => err instanceof PuppeteerConversionError && /required/i.test(err.message),
  );
});

test("puppeteerToTap maps page.type to v2 input kind:type", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.type("#q", "hello");\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.observe, [
    { op: "nav", url: "https://x" },
    { op: "input", kind: "type", target: "#q", value: "hello" },
  ]);
  assert.equal(got.return, "true");
  // Read variant — no act / key.
  assert.equal(got.act, undefined);
  assert.equal(got.key, undefined);
});

test("puppeteerToTap maps keyboard.press without target", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.keyboard.press("Tab");\n`,
    { site: "x", name: "y", intent: "read" },
  );
  assert.deepStrictEqual(got.observe[1], { op: "input", kind: "press", value: "Tab" });
});

test("puppeteerToTap maps page.cookies() to op:cookies", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nconst c = await page.cookies();\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.observe[1], { op: "cookies" });
});

test("puppeteerToTap permissive mode emits op:eval with returns for unsupported page.* call", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.setViewport({ width: 1280, height: 800 });\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.observe[0].op, "nav");
  assert.equal(got.observe[1].op, "eval");
  assert.deepStrictEqual(got.observe[1].returns, { type: "object" });
  assert.match(got.observe[1].fn, /TODO/);
});

test("puppeteerToTap maps page.evaluate to op:eval with mandatory returns", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nconst r = await page.evaluate(() => 42);\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.observe[1].op, "eval");
  assert.deepStrictEqual(got.observe[1].returns, { type: "object" });
});

test("puppeteerToTap maps page.$$eval to op:eval returns:array", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nconst rows = await page.$$eval(".row", els => els.map(e => e.textContent));\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.observe[1].op, "eval");
  assert.deepStrictEqual(got.observe[1].returns, { type: "array" });
});

test("puppeteerToTap strict mode throws on unsupported page.* call", async () => {
  const { puppeteerToTap, PuppeteerConversionError } = await import(DIST);
  assert.throws(
    () =>
      puppeteerToTap(
        `await page.goto("https://x");\nawait page.setViewport({ width: 1, height: 1 });\n`,
        { site: "x", name: "y", strict: true },
      ),
    (err) =>
      err instanceof PuppeteerConversionError &&
      /Unsupported Puppeteer API/.test(err.message),
  );
});

test("puppeteerToTap auto-detects write variant on submit-like click", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.click("button.submit");\n`,
    { site: "x", name: "y" },
  );
  assert.ok(got.act, "expected write variant (act present)");
  assert.ok(got.key, "expected write variant (key present)");
  assert.equal(got.observe, undefined);
});

test("puppeteerToTap auto-detects write variant on password type", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.type("#password", "s3cret");\n`,
    { site: "x", name: "y" },
  );
  assert.ok(got.act, "expected write variant (act present) due to password field");
  assert.ok(got.key);
});

test("puppeteerToTap omits screenshot (not in v2 op closure)", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.screenshot({ path: "x.png" });\n`,
    { site: "x", name: "y" },
  );
  // page.screenshot is now an unsupported call — falls through to
  // permissive op:eval (not silently dropped, not an op:screenshot).
  const observe = got.observe ?? got.act;
  assert.equal(observe.length, 2);
  assert.equal(observe[0].op, "nav");
  assert.equal(observe[1].op, "eval");
});
