import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREATE_DIST = resolve(__dirname, "..", "dist", "create.js");

test("parseArgs accepts the basic positional form", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["github/trending", "https://github.com/trending"]);
  assert.equal(r.site, "github");
  assert.equal(r.name, "trending");
  assert.equal(r.url, "https://github.com/trending");
  assert.equal(r.intent, "read");
  assert.equal(r.force, false);
  assert.equal(r.help, false);
});

test("parseArgs accepts --intent write", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs([
    "ex/login",
    "https://example.test/login",
    "--intent",
    "write",
  ]);
  assert.equal(r.intent, "write");
});

test("parseArgs rejects invalid intent", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  assert.throws(
    () =>
      parseArgs([
        "x/y",
        "https://x",
        "--intent",
        "execute",
      ]),
    /must be "read" or "write"/,
  );
});

test("parseArgs rejects malformed identifier", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  assert.throws(
    () => parseArgs(["GitHub/Trending", "https://x"]),
    /invalid identifier/,
  );
  assert.throws(
    () => parseArgs(["just-one-segment", "https://x"]),
    /invalid identifier/,
  );
});

test("parseArgs rejects non-http URL", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  assert.throws(
    () => parseArgs(["x/y", "ftp://example.com"]),
    /must start with http/,
  );
});

test("parseArgs accepts --help with no positional args", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["--help"]);
  assert.equal(r.help, true);
});

test("buildStarterPlan produces conformant plan-v1", async () => {
  const { buildStarterPlan } = await import(CREATE_DIST);
  const specPath = resolve(__dirname, "..", "..", "spec", "dist", "index.js");
  const spec = await import(specPath);
  const plan = buildStarterPlan({
    site: "github",
    name: "trending",
    url: "https://github.com/trending",
    intent: "read",
  });
  const r = spec.runConformance(plan);
  assert.equal(
    r.pass,
    true,
    `starter plan must pass runConformance. Failures: ${JSON.stringify(r.failures)}`,
  );
});
