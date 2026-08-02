/**
 * Constraint: the peer must OBSERVE the acted-on element before and after the
 * act, so the derived φ has something real to read. Classification: safety/what.
 *
 * Why (ADR tap-core 2026-08-02-the-oracle-obligation-belongs-to-dispatch §6
 * slice 2b): the engine derives `!target.present || target.witness !=
 * target.witness_before` and offers it to the agent. Core already lifts a
 * peer's `_tap_target` onto the OpResult. Until something PRODUCES it the
 * offer is a promissory note: accept it and the φ names nothing.
 *
 * The point of reading the TARGET rather than the page is attribution. A page
 * can be arbitrarily loud — x.com heartbeats POST continuously — and still
 * cannot forge the state of the element we clicked.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   "If a half-impl passed: (a) it reports `present` only, so φ has nothing to
 *    compare against and silently degrades to 'did the button vanish' — TB3
 *    demands all three keys; (b) it reads the target only AFTER the act, so
 *    `witness_before` is whatever the post-click DOM says — TB4 asserts the
 *    before-read precedes the dispatch in source order; (c) it fabricates a
 *    readback when the resolver is unavailable — TB2 asserts a null resolver
 *    yields null, never a confident `present:true`."
 *
 * Run: node extension/test/target-readback.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractBody(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker.trim()} not found — the readback must be a named, self-contained injectable`)
  const arrow = src.indexOf('=> {', start)
  let i = src.indexOf('{', arrow), depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1) }
  }
  throw new Error('unbalanced braces')
}
const READBACK = eval(`((sel) => ${extractBody(BG, 'const TARGET_READBACK = (')})`)

console.log('\ntarget readback (slice 2b producer)')

test('TB1 — a present element yields present:true and its witness', () => {
  const el = {}
  globalThis.document = {}
  globalThis.__tapDeep = {
    pick: () => el,
    implicitRole: () => 'button',
    accName: () => 'Follow',
  }
  const r = READBACK('#f')
  assert.equal(r.present, true)
  assert.deepEqual(r.witness, { role: 'button', name: 'Follow' })
})

test('TB2 — no resolver ⇒ null, never a confident reading', () => {
  globalThis.__tapDeep = undefined
  assert.equal(READBACK('#f'), null,
    'a fabricated readback would let φ evaluate against nothing while looking observed')
})

test('TB2b — resolver present but element gone ⇒ present:false (this IS the signal)', () => {
  globalThis.document = {}
  globalThis.__tapDeep = { pick: () => null, implicitRole: () => '', accName: () => '' }
  const r = READBACK('#f')
  assert.equal(r.present, false)
  assert.equal(r.witness, null)
})

test('TB3 — the click case attaches all THREE keys, or φ cannot compare', () => {
  const arm = BG.slice(BG.indexOf("case 'click': {"), BG.indexOf("case 'type': {"))
  assert.ok(/_tap_target/.test(arm), 'the click case must attach the readback')
  for (const k of ['present', 'witness', 'witness_before']) {
    assert.ok(new RegExp(`\\b${k}\\b`).test(arm),
      `\`${k}\` missing — without it the derived φ silently degrades to a weaker question`)
  }
})

test('TB4 — the BEFORE read precedes the dispatch (else it is not a "before")', () => {
  const arm = BG.slice(BG.indexOf("case 'click': {"), BG.indexOf("case 'type': {"))
  // The EARLIEST act is the resolver call: the untrusted arm's JS click
  // happens inside clickResolver, so that invocation — not cdpClick — is the
  // line a "before" read must precede. (A naive /\.click\(\)/ search matches
  // a comment 500 chars in and would have passed this test on a wrong impl.)
  const before = arm.indexOf('targetBefore')
  const act = arm.indexOf('execFunc(fx, clickResolver')
  assert.ok(before !== -1, 'the before-read must be a named binding')
  assert.ok(act !== -1, 'the resolver invocation must be findable — it IS the act on the untrusted arm')
  assert.ok(before < act,
    'reading the target after clickResolver makes `witness_before` a description ' +
    'of the POST-click DOM: the untrusted arm clicks inside the resolver')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
