/**
 * Constraint: op:input resolver misses retry SUBSTRATE-SIDE, bounded,
 * before failing to the agent.
 * Classification: quality / what — north-star-human-speed (2026-07-12).
 *
 * Why: a resolver miss is frequently a transient re-render race —
 * React/Vue swap the node between page-ready and act. Pre-fix, the miss
 * surfaced immediately as selector_not_found and the retry loop ran in
 * AGENT turns (3–15s of model latency each) or failed a zero-token
 * replay outright. The fix loops at millisecond cost inside the input
 * dispatcher. Safety hinges on the retry predicate: "Element not found"
 * means NOTHING acted, so re-dispatch cannot double-fire.
 *
 * Structural pins (source-extraction style, as architecture.test.mjs):
 *   1. the input case wraps kind-routing in a re-callable dispatchKind
 *   2. retry is BOUNDED (1500ms budget / 150ms step — not unbounded)
 *   3. only "Element not found" retries; other errors rethrow at once
 *   4. kind='resolve' (the probe) never retries — its answer is "now"
 *
 * Run: node extension/test/input-miss-retry.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// Scope all pins to the op:input case block.
const inputCase = BG_SRC.slice(BG_SRC.indexOf("case 'input': {"))
assert(inputCase.length > 100, 'op:input case must exist')

test('kind routing is a re-callable closure (dispatchKind)', () => {
  assert(/const dispatchKind = async \(\) => \{/.test(inputCase),
    'input kinds must route through a dispatchKind closure so a miss can re-dispatch')
})

test('retry is bounded: 1500ms budget, 150ms step', () => {
  assert(/const retryStart = Date\.now\(\)/.test(inputCase) &&
    inputCase.includes('retryStart + 1500'),
    'retry budget must be a bounded deadline (1500ms from first miss)')
  assert(/while \(Date\.now\(\) < deadline\)/.test(inputCase),
    'retry loop must terminate at the deadline')
  assert(/setTimeout\(r, 150\)/.test(inputCase),
    'retry step must poll at 150ms (substrate-side ms cost, not agent turns)')
})

test('only a resolver MISS retries; other errors rethrow immediately', () => {
  assert(/const isMiss = \(err\) => String\(err\?\.message \|\| err\)\.startsWith\('Element not found'\)/.test(inputCase),
    'retry predicate must be exactly the nothing-acted miss shape')
  assert(/if \(kind === 'resolve' \|\| !isMiss\(e\)\) throw e/.test(inputCase),
    'non-miss errors must rethrow without retry')
  assert(/if \(!isMiss\(e2\)\) throw e2/.test(inputCase),
    'a non-miss error DURING retry must also rethrow immediately')
})

test("the 'resolve' probe never retries (its answer is now)", () => {
  assert(/kind === 'resolve' \|\|/.test(inputCase),
    'probe kind must be excluded from the retry path')
})

test('success-after-retry reports the near-miss via _tap_anomalies (leading drift indicator)', () => {
  assert(/const withRetryAnomaly = \(res, n, ms\) =>/.test(inputCase),
    'retry success must flow through the anomaly wrapper')
  assert(/_tap_anomalies: \{ \.\.\.\(res\._tap_anomalies \|\| \{\}\), retries: \{ n, ms \} \}/.test(inputCase),
    'wrapper must attach {retries:{n,ms}} under the reserved key core lifts')
  assert(/withRetryAnomaly\(await dispatchKind\(\), attempts, Date\.now\(\) - retryStart\)/.test(inputCase),
    'the retry-path return must be wrapped; the first-try return must NOT be')
})

test('detach→consequence-nav reclassification is tagged as an anomaly', () => {
  assert(BG_SRC.includes("_tap_anomalies: { reclassified: 'click_detach_consequence_nav' }"),
    'ok-but-reclassified must carry the drift tag — the plan assumed in-page, the substrate navigated')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
