/**
 * Drift-guard — packages/spec/schemas/plan-v1.schema.json ↔ src/types.ts
 *
 * Why: prior to 2026-05-17, the schema file and the TS types drifted
 * silently for 14 days after the v2 launch (2026-05-03). The schema
 * still enumerated 24 v0.x ops (exec/parseXML/screenshot/...) while
 * src/types.ts had the 11-op v2 union. No consumer noticed because
 * downstream packages import TS types, not the JSON schema file.
 * See LeonTing1010/tap#8.
 *
 * This test asserts bidirectional parity of the load-bearing parts:
 *   - OpName.enum in schema ⊇⊆ OP_NAMES_V2 array literal in src/types.ts
 *   - Every TS Op interface name has a $defs entry
 *   - Every $defs op entry references the matching `op: "<name>"` const
 *
 * Failing this test in CI prevents an npm publish whose schema would
 * mislead third-party validators (VS Code $schema, ajv-equivalent libs).
 *
 * Pattern mirrors tap-core/src/test/spec_public_subset_test.ts.
 *
 * Run via `npm test`. Uses Node 20+ built-in test runner (no extra dep).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCHEMA_PATH = resolve(ROOT, "schemas/plan-v1.schema.json");
const TYPES_PATH = resolve(ROOT, "src/types.ts");

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const typesSrc = readFileSync(TYPES_PATH, "utf8");

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Extract the array literal members from `export const FOO = [...] as const;`. */
function extractStringArrayConst(src, name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*\\[([^\\]]+)\\]\\s*as const`,
    "s",
  );
  const m = src.match(re);
  if (!m) throw new Error(`could not find export const ${name} in types.ts`);
  return m[1]
    .split(/[,\n\s]+/)
    .map((s) => s.replace(/^["']|["']$|,/g, "").trim())
    .filter(Boolean);
}

/** Extract names of top-level `export interface <Name> {` declarations. */
function extractInterfaceNames(src) {
  const re = /^export interface (\w+)\s*\{/gm;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

// ─── Assertions ──────────────────────────────────────────────────────────

test("schema OpName.enum exactly matches OP_NAMES_V2 in src/types.ts (bidirectional)", () => {
  const tsOps = extractStringArrayConst(typesSrc, "OP_NAMES_V2");
  const schemaOps = schema.$defs.OpName.enum;

  // Same set (extras either side = drift)
  assert.deepEqual(
    new Set(tsOps),
    new Set(schemaOps),
    `OpName drift:\n  in TS  not in schema: ${tsOps.filter((o) => !schemaOps.includes(o))}\n  in schema not in TS: ${schemaOps.filter((o) => !tsOps.includes(o))}`,
  );

  // Same length confirms no duplicates within either
  assert.equal(tsOps.length, 11, `OP_NAMES_V2 must have 11 entries (got ${tsOps.length})`);
  assert.equal(schemaOps.length, 11, `schema OpName.enum must have 11 entries (got ${schemaOps.length})`);
});

test("every TS op interface has a matching $defs entry", () => {
  const interfaces = extractInterfaceNames(typesSrc);
  // Every Op-suffixed interface (FetchOp, NavOp, ...) must be in schema $defs.
  const opInterfaces = interfaces.filter((n) => /Op$/.test(n) && n !== "Op");

  for (const name of opInterfaces) {
    assert.ok(
      schema.$defs[name],
      `TS interface ${name} has no corresponding entry in schema $defs`,
    );
  }
});

test("every schema $defs op entry references a matching `op: \"<name>\"` const", () => {
  const opInterfaces = extractInterfaceNames(typesSrc).filter(
    (n) => /Op$/.test(n) && n !== "Op",
  );

  for (const name of opInterfaces) {
    const def = schema.$defs[name];
    const opProp = def?.properties?.op;
    assert.ok(opProp, `${name} $defs entry missing properties.op`);
    assert.ok(
      typeof opProp.const === "string",
      `${name}.properties.op must be { const: "<name>" }; got ${JSON.stringify(opProp)}`,
    );
    const tsOps = extractStringArrayConst(typesSrc, "OP_NAMES_V2");
    assert.ok(
      tsOps.includes(opProp.const),
      `${name}.properties.op.const = "${opProp.const}" is not a member of OP_NAMES_V2`,
    );
  }
});

test("schema $id points at the canonical taprun.dev URL", () => {
  assert.equal(
    schema.$id,
    "https://taprun.dev/spec/plan-v1/schema.json",
    "schema.$id must be the canonical taprun.dev URL so $schema references resolve",
  );
});

test("schema does not enumerate any deleted v0.x op names", () => {
  // Sentinel list — exact names that were in v0.x schema and got deleted
  // at v2 launch (2026-05-03). Catching these is the regression check for
  // the original silent-drift bug. See LeonTing1010/tap#8.
  const V0X_DELETED = [
    "exec", "parseXML", "screenshot", "scroll",
    "compute", "filter", "project", "sort", "dedupe",
    "pick", "limit", "concat", "pipe",
  ];
  const schemaOps = schema.$defs.OpName.enum;
  const leaked = V0X_DELETED.filter((o) => schemaOps.includes(o));
  assert.deepEqual(
    leaked,
    [],
    `schema OpName.enum leaks v0.x deleted ops: ${leaked.join(", ")}`,
  );
});

test("VERDICT_VALUES has the v2 3-arm shape", () => {
  const verdicts = extractStringArrayConst(typesSrc, "VERDICT_VALUES");
  assert.deepEqual(
    new Set(verdicts),
    new Set(["live", "drifted", "unreachable"]),
    `VERDICT_VALUES must be the v2 3-arm enum; got: ${verdicts.join(",")}`,
  );
});
