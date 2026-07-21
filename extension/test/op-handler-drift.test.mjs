/**
 * Constraint: op-union ↔ SW-handler correspondence.
 *
 * When core retires an op from `OP_NAMES_V2` (core/types.ts), its `handleMethod`
 * case in background.js MUST be deleted in the same change. Otherwise the two
 * surfaces drift and dead handlers accumulate — exactly what happened to
 * `highlight` / `screencast` / `point`: retired by ADR
 * `2026-07-13-op-union-minimization`, yet their SW handlers lingered ~unreachable
 * (no plan op can dispatch to them) until 2026-07-21. A dead handler is not
 * inert — it is code volume, an attack/maintenance surface, and a lie about the
 * op set the extension actually serves.
 *
 * Why a curated denylist, not a live diff against OP_NAMES_V2: the extension
 * (public repo, Node tests) cannot import core's Deno `OP_NAMES_V2` — the
 * dependency runs the OTHER way (core CI pulls the extension). So the retirement
 * list is mirrored here by hand, guarded by this test. The discipline: per each
 * future op retirement, add the op name below in the SAME PR that deletes its
 * SW handler — identical to tap's other hand-mirrored drift guards
 * (spec_public_subset, etc.). The test then fails loudly if the handler is left
 * behind, or if a retired handler is ever re-introduced.
 *
 * Run: node extension/test/op-handler-drift.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

// Ops removed from core/types.ts OP_NAMES_V2. Their handleMethod case MUST NOT exist.
const RETIRED_SUBSTRATE_OPS = [
  { op: 'highlight', adr: '2026-07-13-op-union-minimization' },
  { op: 'screencast', adr: '2026-07-13-op-union-minimization' },
  { op: 'point', adr: '2026-07-13-op-union-minimization' },
]

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

console.log('\n  -- op-union ↔ SW-handler correspondence (no retired-op handlers) --\n')

for (const { op, adr } of RETIRED_SUBSTRATE_OPS) {
  test(`retired op '${op}' has NO handleMethod case (ADR ${adr})`, () => {
    const re = new RegExp(`case\\s*'${op}'\\s*:`)
    assert(
      !re.test(BG),
      `background.js still handles retired op '${op}' — delete its \`case '${op}': {…}\`. ` +
      `It was retired from OP_NAMES_V2 by ADR ${adr}; no plan op can reach it, so it is dead weight + surface drift.`,
    )
  })
}

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
