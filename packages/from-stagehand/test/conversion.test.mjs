import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "fixtures");
const DIST = resolve(__dirname, "..", "dist", "index.js");

test("stagehandToTap converts fixture sources to expected v2 Plan", async () => {
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
      site: expected.id.site,
      name: expected.id.name,
      // Let the adapter auto-detect intent; the fixture is structured
      // to match the auto-detection result.
    });

    assert.deepStrictEqual(
      got,
      expected,
      `${basename(inputName)} → produced v2 Plan does not match ${expectedName}`,
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

test("stagehandToTap maps deterministic page.* calls to v2 ops (read variant)", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait page.click("#btn");\n`,
    { site: "x", name: "y" },
  );
  assert.deepStrictEqual(got.observe, [
    { op: "nav", url: "https://x" },
    { op: "input", kind: "click", target: "#btn" },
  ]);
  assert.equal(got.return, "true");
  // Read variant — no act / key.
  assert.equal(got.act, undefined);
  assert.equal(got.key, undefined);
});

test("stagehandToTap NL act() emits op:eval with prompt preserved as TODO", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait stagehand.act("click the login button");\n`,
    { site: "x", name: "y" },
  );
  // Login-flavored prompt → write variant detected.
  assert.ok(Array.isArray(got.act));
  assert.equal(got.act[0].op, "nav");
  assert.equal(got.act[1].op, "eval");
  assert.equal(got.act[1].returns.type, "object");
  assert.match(got.act[1].fn, /click the login button/);
  // v2 has no allowUnverifiable field on Plan.
  assert.equal(got.allowUnverifiable, undefined);
});

test("stagehandToTap stagehand.extract preserves NL prompt in op:eval", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait stagehand.extract("the price", schema);\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.observe[1].op, "eval");
  assert.equal(got.observe[1].returns.type, "object");
  assert.match(got.observe[1].fn, /extract\("the price"\)/);
});

test("stagehandToTap stagehand.observe emits op:eval returns:array", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x");\nawait stagehand.observe();\n`,
    { site: "x", name: "y" },
  );
  assert.equal(got.observe[1].op, "eval");
  assert.equal(got.observe[1].returns.type, "array");
});

test("stagehandToTap silently skips lifecycle methods (init/close)", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await stagehand.init();\nawait page.goto("https://x");\nawait stagehand.close();\n`,
    { site: "x", name: "y" },
  );
  // Only the goto should produce an op.
  assert.equal(got.observe.length, 1);
  assert.equal(got.observe[0].op, "nav");
});

test("stagehandToTap detects write variant on password fill", async () => {
  const { stagehandToTap } = await import(DIST);
  const got = stagehandToTap(
    `await page.goto("https://x/login");\nawait page.fill("#password", "secret");\n`,
    { site: "x", name: "login" },
  );
  assert.ok(Array.isArray(got.act));
  assert.equal(got.key, '"x:login:" + string($args)');
});

test("stagehandToTap strict mode throws on unsupported call", async () => {
  const { stagehandToTap, StagehandConversionError } = await import(DIST);
  assert.throws(
    () =>
      stagehandToTap(
        `await page.goto("https://x");\nawait page.dragAndDrop("#a", "#b");\n`,
        { site: "x", name: "y", strict: true },
      ),
    (err) =>
      err instanceof StagehandConversionError &&
      /Unsupported Stagehand\/Playwright API/.test(err.message),
  );
});
