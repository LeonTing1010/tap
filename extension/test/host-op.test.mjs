/**
 * host-op.test.mjs — op:host generic interpreter (Lane B).
 * ADR 2026-07-16-primitive-set-narrow-waist-and-thin-host-capability-registry.
 *
 * The Lane-B guarantee is the ABSENCE of per-cap code: op:host runs
 * chrome.<namespace>.<method>(...) from the core-resolved `_cap`, so adding a
 * capability is a registry edit (core/assets/host-caps.json), never a change
 * to this handler. These source assertions pin that absence.
 *
 * Run: node extension/test/host-op.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

function slice(marker, len) {
  const i = BG.indexOf(marker)
  assert(i >= 0, `marker not found: ${marker}`)
  return BG.slice(i, i + len)
}

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

console.log('\nop:host generic interpreter (Lane B)\n')

test("case 'host' handler exists", () => {
  assert(BG.includes("case 'host': {"), 'op:host handler must exist')
})

const body = slice("case 'host': {", 1300)

test('reads the core-resolved _cap (extension keeps NO registry copy)', () => {
  assert(body.includes('params._cap'), 'must read params._cap')
})

test('generic dispatch — chrome[namespace][method], with NO per-cap branch', () => {
  assert(body.includes('chrome[spec.namespace]'), 'must index chrome by namespace')
  assert(body.includes('spec.method'), "must call the spec's method")
  // Adversarial (Phase 1a): a handler that branched on a cap name would
  // defeat Lane B. No cap name may appear in the handler body.
  assert(!body.includes('tab-reload'), 'handler must NOT hardcode a cap name')
})

test('defense-in-depth namespace allowlist (mirrors core HOST_CAP_NAMESPACES)', () => {
  assert(
    body.includes("new Set(['tabs', 'windows'])"),
    'must guard the namespace against arbitrary chrome-API invocation',
  )
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
