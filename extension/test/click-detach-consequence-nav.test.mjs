/**
 * Constraint: (D1) a click/press whose frame detaches DURING dispatch while
 * the bound tab navigates away is a CONSEQUENCE NAVIGATION — reported as
 * {dispatched:true, navigated:true}, never as a hard "detached" error; and
 * (D2) a READ-shaped op (eval/extract/wait) whose bound tab is gone rebinds
 * declaratively to a live same-origin tab, while a WRITE-shaped op (input)
 * is NEVER auto-rebound.
 * Classification: safety / what — ADR 2026-07-12-click-detach-consequence-nav.
 *
 * Why: the tab binding is a LEASE, not a durable handle (fact T1/T3 — the
 * user co-owns the tab; the engine can't sense staleness). Stream-log
 * evidence (2026-07-03..11): "detached while handling" hard-failed runs
 * whose click HAD landed (submit → redirect destroyed the frame — the
 * success shape), and "No active tab" killed read probes when a same-origin
 * tab was sitting right there. The classifier claims only the DISPATCH;
 * effect verification stays with confirm/postcondition. The rebind is
 * read-only: acting on a merely-same-origin tab risks writing into wrong
 * page state, so input keeps the hard error.
 *
 * ADVERSARIAL framing: a half-impl that reclassified EVERY detach error as
 * success would false-positive clicks that detached without navigation
 * (assert: classifier requires navigated||loading probe); one that rebound
 * writes too would break the safety boundary (assert: `method !== 'input'`
 * gates the rebind); one that compared against a POST-dispatch URL would
 * always see equality (assert: snapshot taken before dispatch).
 *
 * Source-slice tests (matching this repo's convention for SW-context code
 * that node can't execute end-to-end): each asserts the load-bearing
 * condition text is present and correctly shaped in background.js.
 *
 * Run: node extension/test/click-detach-consequence-nav.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

console.log('\n  -- D1: click-detach consequence-nav classifier --\n')

test('D1-gesture-gate — classifier fires only for click/press input', () => {
  const m = BG_SRC.match(/const isNavGesture = ([^\n]+)/)
  assert(m, 'isNavGesture assignment must exist')
  assert(m[1].includes("method === 'input'"), 'gated on op:input')
  assert(m[1].includes("'click'") && m[1].includes("'press'"), 'click and press are the navigating gestures')
})

test('D1-detach-shape — classifier keys on detach-shaped errors only', () => {
  assert(/const isDetachShape = \/.*detached.*\/i\.test\(errMsg\)/.test(BG_SRC),
    'detach shape regex must test the error message')
})

test('D1-nav-probe — reclassification requires an observed navigation (navigated || loading)', () => {
  assert(BG_SRC.includes('navigated || loading'),
    'must probe the live tab and require navigated||loading — never reclassify a detach without navigation')
})

test('D1-pre-dispatch-snapshot — baseline URL is captured BEFORE dispatch', () => {
  const snapIdx = BG_SRC.indexOf('let preDispatchUrl = null')
  const dispatchIdx = BG_SRC.indexOf("await handleMethod(method, resolvedParams, null, { fromDaemon: true })")
  assert(snapIdx !== -1 && dispatchIdx !== -1 && snapIdx < dispatchIdx,
    'preDispatchUrl snapshot must precede the dispatch call')
})

test('D1-claims-dispatch-only — reclassified result carries dispatched, never a success claim of effect', () => {
  assert(BG_SRC.includes('dispatched: true') && BG_SRC.includes('Verify the effect via confirm/postcondition'),
    'the classifier claims the dispatch only; effect verification stays with the plan')
})

console.log('\n  -- D2: declarative read-op rebind --\n')

test('D2-read-only-rebind — the rebind path is gated on method !== input', () => {
  const m = BG_SRC.match(/if \(!liveTab && method !== 'input'\)/)
  assert(m, 'write-shaped ops must never auto-rebind — a same-origin tab is not the same page state')
})

test('D2-origin-match — rebind candidates are same-origin with the session URL', () => {
  const idx = BG_SRC.indexOf("if (!liveTab && method !== 'input')")
  const slice = BG_SRC.slice(idx, idx + 1200)
  assert(slice.includes('new URL(t.url).origin === origin'),
    'candidate filter must compare origins')
})

test('D2-tiebreak — active tab preferred, then most-recently-accessed (op:nav attach parity)', () => {
  const idx = BG_SRC.indexOf("if (!liveTab && method !== 'input')")
  const slice = BG_SRC.slice(idx, idx + 1200)
  assert(slice.includes('b.active ? 1 : 0') && slice.includes('lastAccessed'),
    'rebind tiebreak must mirror the op:nav attach multi-match resolution')
})

test('D2-persist — a successful rebind persists the session mutation', () => {
  const idx = BG_SRC.indexOf("if (!liveTab && method !== 'input')")
  const slice = BG_SRC.slice(idx, idx + 1400)
  assert(slice.includes('persistSessions()'),
    'rebound tabId must survive SW restart (storage.session write-through)')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
