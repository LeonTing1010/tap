/**
 * Constraint: a TRUSTED click must hit-test its coordinates against the resolved
 * target BEFORE dispatching. Coordinates resolved at time T are clicked at time
 * T+Δ; any reflow in between (lazy images, a feed loading, a carousel) moves the
 * target and the CDP click lands somewhere else — or on nothing.
 * Classification: correctness / what — provable miss detection, trusted arm.
 *
 * Why (2026-08-01 goofish 下架 dogfood): a trusted click was dispatched at
 * coordinates captured in an earlier call. The button had moved 120px. The click
 * landed on empty space, the op returned ok:true, and the listing stayed live.
 *
 * Why not the effect watch: CLICK_WATCH counts ANY mutation and ANY fetch/XHR in
 * a 450ms window with NO attribution to the click. On a live commercial page
 * (auto-rotating carousel + telemetry polling — goofish has both) it is
 * structurally never all-zero, so neither the untrusted escalation nor the
 * trusted inert report can fire. Hit-testing needs no attribution: "is the thing
 * I am about to click the thing I resolved" is decidable from geometry alone.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   "If a half-impl passed: (a) a hit test that always returns true — caught by
 *    HIT3/HIT4, which run it against a DOM double where the point resolves to a
 *    DIFFERENT element and to null; (b) hit-testing AFTER the click (useless —
 *    the miss already happened) — caught by HIT6, which asserts the call site
 *    precedes cdpClick in source order; (c) merely re-checking the selector
 *    still resolves, ignoring geometry — caught by HIT4, where the selector
 *    resolves fine but the POINT belongs to an overlay."
 *   The predicate is EXECUTED against DOM doubles, not grepped.
 *
 * Run: node extension/test/trusted-click-hittest.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractFn(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker.trim()} not found — the hit test must be a named, self-contained injectable const`)
  const bodyStart = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (!depth) { i++; break } }
  }
  return src.slice(src.indexOf('(', start), i)
}

const srcOrErr = (() => { try { return extractFn(BG, 'const CLICK_HIT_TEST = ') } catch (e) { return e } })()
const hitTest = srcOrErr instanceof Error ? null : eval('(' + srcOrErr + ')')

const clickCase = (() => {
  const hits = [...BG.matchAll(/case 'click'/g)]
    .map((m) => BG.slice(m.index, BG.indexOf("case '", m.index + 12)))
    .filter((s) => s.includes('CLICK_WATCH_ARM'))
  return hits[0] || ''
})()
if (!clickCase) throw new Error('could not locate the op:input click case')

/** Minimal DOM double: elementFromPoint + querySelector + contains. */
function domDouble({ target, atPoint }) {
  const g = globalThis
  const prevDoc = g.document
  g.document = {
    querySelector: (s) => (target && target._sel === s ? target : null),
    elementFromPoint: () => atPoint,
  }
  return () => { g.document = prevDoc }
}
const el = (sel, parent) => {
  const e = { _sel: sel, contains(n) { return n === e || (n && n._parent === e) } }
  if (parent) e._parent = parent
  return e
}

console.log('\n  -- a trusted click must not fire at coordinates that no longer hold its target --\n')

test('HIT1 — CLICK_HIT_TEST exists as a named injectable const', () => {
  if (srcOrErr instanceof Error) throw srcOrErr
  assert(typeof hitTest === 'function')
})

test('HIT2 — TRUE when the point lands on the resolved element itself', () => {
  const t = el('#go')
  const restore = domDouble({ target: t, atPoint: t })
  try { assert.equal(hitTest('#go', 1, 1), true) } finally { restore() }
})

test('HIT3 — TRUE when the point lands on a DESCENDANT (label inside a button)', () => {
  const t = el('#go'); const child = el('#go>span', t)
  const restore = domDouble({ target: t, atPoint: child })
  try { assert.equal(hitTest('#go', 1, 1), true) } finally { restore() }
})

test('HIT4 — FALSE when the selector still resolves but the POINT is another element', () => {
  const t = el('#go'); const overlay = el('.overlay')
  const restore = domDouble({ target: t, atPoint: overlay })
  try {
    assert.equal(hitTest('#go', 1, 1), false,
      'stale coordinates land on whatever moved into that spot — re-resolving the ' +
      'selector proves nothing about geometry')
  } finally { restore() }
})

test('HIT5 — FALSE when the point hits nothing at all', () => {
  const t = el('#go')
  const restore = domDouble({ target: t, atPoint: null })
  try { assert.equal(hitTest('#go', 1, 1), false) } finally { restore() }
})

test('HIT6 — the hit test runs BEFORE cdpClick on the trusted path', () => {
  const i = clickCase.indexOf('CLICK_HIT_TEST')
  const c = clickCase.indexOf('await cdpClick(tabId, result.x + dx, result.y + dy)')
  assert(i > -1, 'trusted path must invoke CLICK_HIT_TEST')
  assert(c > -1, 'trusted cdpClick call site missing')
  assert(i < c, 'hit-testing AFTER the click is useless — the miss already happened')
})

test('HIT7 — a proven miss is surfaced, not swallowed', () => {
  assert(/stale_coords|coords_missed|hit_test/.test(clickCase),
    'a click whose coordinates no longer hold the target must surface the fact — ' +
    'that is the whole bug: ok:true on a click that hit nothing')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed) process.exit(1)
