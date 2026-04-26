import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const DIST = resolve(__dirname, "..", "dist", "index.js");

test("puppeteerToTap converts fixture sources to expected .tap.json", async () => {
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

test("puppeteerToTap maps page.type to plan-v1 fill", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.type("#q", "hello");\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops, [
    { op: "nav", url: "https://x" },
    { op: "input", kind: "fill", target: "#q", value: "hello" },
  ]);
});

test("puppeteerToTap maps keyboard.press without target", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.keyboard.press("Tab");\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops[1], { op: "input", kind: "press", value: "Tab" });
});

test("puppeteerToTap permissive mode emits exec for unsupported page.* call", async () => {
  const { puppeteerToTap } = await import(DIST);
  const got = puppeteerToTap(
    `await page.goto("https://x");\nawait page.evaluate(() => 42);\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.body.ops[0].op, "nav");
  assert.equal(got.body.ops[1].op, "exec");
  assert.equal(got.body.allowUnverifiable, true);
});

test("puppeteerToTap strict mode throws on unsupported page.* call", async () => {
  const { puppeteerToTap, PuppeteerConversionError } = await import(DIST);
  assert.throws(
    () =>
      puppeteerToTap(
        `await page.goto("https://x");\nawait page.evaluate(() => 1);\n`,
        { site: "x", name: "y", strict: true },
      ),
    (err) =>
      err instanceof PuppeteerConversionError &&
      /Unsupported Puppeteer API/.test(err.message),
  );
});
