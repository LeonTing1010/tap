import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREATE_DIST = resolve(__dirname, "..", "dist", "create.js");

test("parseArgs accepts the basic positional form (id only)", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["github/issues"]);
  assert.equal(r.site, "github");
  assert.equal(r.name, "issues");
  assert.equal(r.variant, "read");
  assert.equal(r.force, false);
  assert.equal(r.help, false);
  assert.match(r.description, /github\/issues/);
});

test("parseArgs accepts <id> \"<description>\"", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["github/issues", "List issues for a repo"]);
  assert.equal(r.description, "List issues for a repo");
});

test("parseArgs --write switches to write variant", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["gmail/send", "Send mail", "--write"]);
  assert.equal(r.variant, "write");
});

test("parseArgs --variant write equivalent to --write", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["x/y", "desc", "--variant", "write"]);
  assert.equal(r.variant, "write");
});

test("parseArgs rejects invalid --variant", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  assert.throws(
    () => parseArgs(["x/y", "desc", "--variant", "execute"]),
    /must be "read" or "write"/,
  );
});

test("parseArgs rejects malformed identifier", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  assert.throws(
    () => parseArgs(["GitHub/Trending"]),
    /invalid identifier/,
  );
  assert.throws(
    () => parseArgs(["just-one-segment"]),
    /invalid identifier/,
  );
});

test("parseArgs accepts --help with no positional args", async () => {
  const { parseArgs } = await import(CREATE_DIST);
  const r = parseArgs(["--help"]);
  assert.equal(r.help, true);
});

test("buildStarterPlan (read) produces a v2 Plan with no envelope", async () => {
  const { buildStarterPlan, validateV2Plan } = await import(CREATE_DIST);
  const plan = buildStarterPlan({
    site: "github",
    name: "issues",
    description: "List issues",
    variant: "read",
  });
  // Structural v2 invariants
  const r = validateV2Plan(plan);
  assert.equal(
    r.ok,
    true,
    `starter plan must validate. Failures: ${JSON.stringify(r.failures)}`,
  );
  // Spot checks
  assert.deepEqual(plan.id, { site: "github", name: "issues" });
  assert.equal(plan.requires.runtime, "extension");
  assert.equal(typeof plan.return, "string");
  assert.ok(Array.isArray(plan.observe));
  assert.equal(plan.observe[0].op, "fetch");
  assert.equal(plan.observe[0].credentials, "page-session");
  // Canonical Tap v2 phase-1.x template syntax is JSONata: {{$args.X}}
  // (no spaces, $ prefix denotes a context variable). CEL swap is
  // forward-looking only — see core/CLAUDE.md "Plan Runtime (v2)".
  assert.match(plan.observe[0].url, /\{\{\$args\.someArg\}\}/);
  // No v1 fields
  assert.equal(plan["@context"], undefined);
  assert.equal(plan.body, undefined);
  assert.equal(plan.intent, undefined);
  assert.equal(plan.legacy, undefined);
  assert.equal(plan.generator, undefined);
  // Read variant: act/key absent
  assert.equal(plan.act, undefined);
  assert.equal(plan.key, undefined);
});

test("buildStarterPlan (write) emits act + key", async () => {
  const { buildStarterPlan, validateV2Plan } = await import(CREATE_DIST);
  const plan = buildStarterPlan({
    site: "gmail",
    name: "send",
    description: "Send mail",
    variant: "write",
  });
  const r = validateV2Plan(plan);
  assert.equal(
    r.ok,
    true,
    `write starter must validate. Failures: ${JSON.stringify(r.failures)}`,
  );
  assert.ok(Array.isArray(plan.act));
  assert.equal(plan.act[0].op, "fetch");
  assert.equal(plan.act[0].method, "POST");
  assert.equal(typeof plan.key, "string");
  assert.equal(typeof plan.dedup_ttl_seconds, "number");
});

test("validateV2Plan rejects v1 W3C envelope shapes", async () => {
  const { validateV2Plan } = await import(CREATE_DIST);
  const v1 = {
    "@context": ["http://www.w3.org/ns/anno.jsonld"],
    type: "Annotation",
    body: { type: "tap:ExecutionPlan", site: "x", name: "y", ops: [] },
  };
  const r = validateV2Plan(v1);
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /@context/.test(f)));
});

test("validateV2Plan rejects forbidden op:exec", async () => {
  const { validateV2Plan } = await import(CREATE_DIST);
  const bad = {
    id: { site: "x", name: "y" },
    return: "$1",
    observe: [{ op: "exec", fn: "() => 1" }],
  };
  const r = validateV2Plan(bad);
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /forbidden v1 op/.test(f)));
});
