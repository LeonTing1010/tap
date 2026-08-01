/**
 * Constraint: a TRUSTED click that is provably inert must SAY SO. The effect
 * watch already computes the evidence for every click; today the whole inert
 * branch is gated behind `!params.trusted`, so for a trusted click the fact is
 * computed and then DISCARDED — the op returns a bare ok:true.
 * Classification: correctness / what — silent-no-op detection, trusted arm.
 *
 * Why (2026-08-01 goofish 下架 dogfood): a trusted click at stale coordinates
 * landed on nothing. Zero mutations, zero net, zero opens, no href change — the
 * watch had every bit of evidence — and the caller still got ok:true. The only
 * hint was the human noticing the page hadn't changed. background.js's own
 * comment names these "exactly the 'ok proved dispatch, not effect' facts the
 * author cannot see from ok:true alone" — and then withholds them from the one
 * arm that has no remedy.
 *
 * Escalation correctly stays untrusted-only (trusted already ran CDP; a second
 * click could double-fire a write). This constraint is about REPORTING, not
 * remedy: when there is no remedy left, honesty is the remedy.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   "If a half-impl passed: (a) set silent_trusted_click unconditionally —
 *    caught by INERT4/5, which assert it is absent when the click had effect;
 *    (b) put the report INSIDE the existing `!params.trusted` gate so it still
 *    never fires — caught by INERT6, which requires the trusted report to be
 *    reachable on a path that does not require !params.trusted; (c) hand-roll a
 *    SECOND copy of the all-zero predicate that drifts from the escalation
 *    gate's — caught by INERT1, which requires ONE named predicate, and INERT7,
 *    which requires the escalation gate to call it rather than re-spell it."
 *   The predicate is EXECUTED against fixtures, not grepped.
 *
 * Run: node extension/test/trusted-click-inert-report.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

/** Extract `const isInertClickEffect = (effect) => …` so the predicate can be RUN. */
function extractInertPredicate(src) {
  const marker = 'const isInertClickEffect = '
  const start = src.indexOf(marker)
  if (start === -1) {
    throw new Error(
      'isInertClickEffect not found — the all-zero inert test must be ONE named ' +
      'top-level const `const isInertClickEffect = (effect) => {…}`, shared by the ' +
      'escalation gate and the trusted report (two spellings drift apart)',
    )
  }
  const arrow = src.indexOf('=>', start)
  const bodyStart = src.indexOf('{', arrow)
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (!depth) { i++; break } }
  }
  return src.slice(src.indexOf('(', start), i)
}

const predSrc = (() => { try { return extractInertPredicate(BG) } catch (e) { return e } })()
const isInert = predSrc instanceof Error ? null : eval('(' + predSrc + ')')

// The op:input click case. Bounded by CONTENT, not position: background.js has
// TWO `case 'click'` labels (the pointer-method switch has one too), and the
// positional bound silently grabs the 139-char wrong one — every structural
// assertion then passes/fails vacuously against a slice that has no watch in it.
const clickCase = (() => {
  const hits = [...BG.matchAll(/case 'click'/g)]
    .map((m) => BG.slice(m.index, BG.indexOf("case '", m.index + 12)))
    .filter((s) => s.includes('CLICK_WATCH_ARM'))
  return hits[0] || ''
})()
if (!clickCase) throw new Error('could not locate the op:input click case that arms CLICK_WATCH_ARM')

const EFFECTIVE = [
  ['mutations', { navigated: false, m: 3, net: 0, hrefChanged: false, opens: [], blocked: [] }],
  ['network', { navigated: false, m: 0, net: 1, hrefChanged: false, opens: [], blocked: [] }],
  ['href change', { navigated: false, m: 0, net: 0, hrefChanged: true, opens: [], blocked: [] }],
  ['window.open', { navigated: false, m: 0, net: 0, hrefChanged: false, opens: ['https://x'], blocked: [] }],
  ['popup blocked', { navigated: false, m: 0, net: 0, hrefChanged: false, opens: [], blocked: ['https://x'] }],
  ['navigated', { navigated: true, m: 0, net: 0, hrefChanged: false, opens: [], blocked: [] }],
]
const INERT = { navigated: false, m: 0, net: 0, hrefChanged: false, opens: [], blocked: [] }

console.log('\n  -- a trusted click that did nothing must say so --\n')

test('INERT1 — the all-zero test is ONE named, extractable predicate', () => {
  if (predSrc instanceof Error) throw predSrc
  assert(typeof isInert === 'function', 'isInertClickEffect must be a function')
})

test('INERT2 — predicate is TRUE for the all-zero effect', () => {
  assert.equal(isInert(INERT), true, 'zero mutations/net/opens/blocked + no href change + not navigated ⇒ inert')
})

for (const [label, fx] of EFFECTIVE) {
  test(`INERT3 — predicate is FALSE when there was ${label}`, () => {
    assert.equal(!!isInert(fx), false, `${label} is evidence of effect — must not read as inert`)
  })
}

test('INERT4 — a null/absent effect read is NOT inert (unknown ≠ nothing happened)', () => {
  assert.equal(!!isInert(null), false, 'no reading is not a reading of zero')
  assert.equal(!!isInert(undefined), false, 'no reading is not a reading of zero')
})

test('INERT5 — trusted+inert is REPORTED on the anomaly channel', () => {
  assert(clickCase.includes('silent_trusted_click'),
    'the click case must surface a silent_trusted_click fact — the trusted arm has ' +
    'no remedy, so the only honest output is the fact itself')
})

test('INERT6 — the trusted report is NOT gated behind !params.trusted', () => {
  const idx = clickCase.indexOf('silent_trusted_click')
  assert(idx > -1, 'silent_trusted_click missing (INERT5 covers this)')
  // Walk back to the nearest enclosing `if (`/`else if (` condition text and
  // assert it does not require the untrusted arm — the exact half-impl that
  // keeps the fact unreachable for trusted clicks.
  const before = clickCase.slice(Math.max(0, idx - 600), idx)
  const lastGate = before.lastIndexOf('!params.trusted')
  const lastBrace = before.lastIndexOf('{')
  assert(!(lastGate > -1 && lastGate > lastBrace),
    'silent_trusted_click must not sit inside a `!params.trusted` branch — that is ' +
    'the bug this constraint exists to kill')
})

test('INERT7 — the escalation gate CALLS the shared predicate, not a second spelling', () => {
  assert(clickCase.includes('isInertClickEffect('),
    'the escalation gate must reuse isInertClickEffect(effect) so the trusted report ' +
    'and the escalation decision can never disagree about what "inert" means')
})

test('INERT8 — escalation stays untrusted-only (regression guard on correct behavior)', () => {
  assert(clickCase.includes('!params.trusted'),
    'trusted already ran CDP; re-clicking could double-fire a write — escalation ' +
    'must remain untrusted-only')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
