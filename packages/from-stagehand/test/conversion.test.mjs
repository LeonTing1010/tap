import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const DIST = resolve(__dirname, "..", "dist", "index.js");

test("stagehandToTap converts fixture sources to expected .tap.json", async () => {
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

    const got = mod.stagehandToTap(source, {
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

test("stagehandToTap throws on empty source", async () => {
  const { stagehandToTap, StagehandConversionError } = await import(DIST);
  assert.throws(
    () => stagehandToTap("// just a comment\n", { site: "x", name: "y" }),
    (err) =>
      err instanceof StagehandConversionError &&
      /no Stagehand or Playwright API calls/.test(err.message),
  );
});

test("stagehandToTap requires site and name", async () => {
  const { stagehandToTap, StagehandConversionError } = await import(DIST);
  assert.throws(
    () => stagehandToTap("await page.goto('https://x');", { site: "", name: "y" }),
    (err) => err instanceof StagehandConversionError && /required/i.test(err.message),
  );
});

test("stagehandToTap maps deterministic page.* calls", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait page.click("#btn");\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.body.ops, [
    { op: "nav", url: "https://x" },
    { op: "input", kind: "click", target: "#btn" },
  ]);
  assert.equal(got.body.allowUnverifiable, undefined);
});

test("stagehandToTap NL calls produce allowUnverifiable exec ops", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait stagehand.act("click the login button");\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.body.ops[0].op, "nav");
  assert.equal(got.body.ops[1].op, "exec");
  assert.match(got.body.ops[1].fn, /click the login button/);
  assert.equal(got.body.allowUnverifiable, true);
});

test("stagehandToTap stagehand.extract preserves NL prompt", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait stagehand.extract("the price", schema);\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.body.ops[1].op, "exec");
  assert.match(got.body.ops[1].fn, /extract\("the price"\)/);
});

test("stagehandToTap silently skips lifecycle methods (init/close)", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await stagehand.init();\nawait page.goto("https://x");\nawait stagehand.close();\n`,
    { site: "x", name: "y" },
  );
  // Only the goto should produce an op.
  assert.equal(got.body.ops.length, 1);
  assert.equal(got.body.ops[0].op, "nav");
  assert.equal(got.body.allowUnverifiable, undefined);
});
