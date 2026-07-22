/**
 * Constraint: single-source-of-truth invariants for the shared resolver.
 *
 * The 2026-07-21 refactor moved the ~300-line semantic resolver OUT of
 * background.js into tap-deep.js (one module injected into the SW AND every
 * peer AND every test) and collapsed a duplicated `vis` predicate to one
 * definition. Both gains are STATE unless a static check makes their reversal
 * fail the build — this file is that check. A hand-slip that re-inlines the
 * resolver or re-duplicates `vis` turns red here, not silently in a drift six
 * weeks later (the exact class op-handler-drift.test.mjs guards for retired ops).
 *
 * Run: node extension/test/single-source.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
const TAPDEEP = readFileSync(new URL('../tap-deep.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

console.log('\n  -- single source of truth: the shared resolver lives in tap-deep.js only --\n')

test('TAP_DEEP_INSTALL is DEFINED in tap-deep.js (the single source)', () => {
  assert(TAPDEEP.includes('const TAP_DEEP_INSTALL ='),
    'tap-deep.js must define `const TAP_DEEP_INSTALL =` — it is the one injectable resolver source')
})

test('background.js does NOT re-inline TAP_DEEP_INSTALL (imports it instead)', () => {
  assert(!BG.includes('const TAP_DEEP_INSTALL ='),
    'background.js must NOT define `const TAP_DEEP_INSTALL =` — re-inlining forks the resolver from ' +
    'every peer + test that inject tap-deep.js. It must `await import(\'./tap-deep.js\')` in ensureDeep.')
  // 2026-07-22: MV3 module-SW forbids runtime import() (w3c/ServiceWorker#1356)
  // — the lazy import threw "import() is disallowed" on every resolver op.
  // The one legal loading form is a static top-level import (protocol.test
  // Rule 6 carries the matching carve-out).
  assert(/import\s*\{\s*TAP_DEEP_INSTALL\s*\}\s*from\s*['"]\.\/tap-deep\.js['"]/.test(BG),
    'background.js must statically import TAP_DEEP_INSTALL from ./tap-deep.js (MV3 SW forbids runtime import())')
})

test('the `vis` visibility predicate is defined EXACTLY ONCE (no re-duplication)', () => {
  // `const vis = (e) =>` is the DEFINITION; clickResolver aliases it as
  // `const vis = globalThis.__tapDeep.vis` (not a redefinition). Count the
  // definition form across both files — must be 1 (in tap-deep.js).
  const defs = (BG + '\n' + TAPDEEP).match(/const vis = \(e\) =>/g) || []
  assert.equal(defs.length, 1,
    `the vis predicate must be defined once (found ${defs.length}). A second inline copy is the R2 drift ` +
    `the 2026-07-21 dedup removed — reference globalThis.__tapDeep.vis instead.`)
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
