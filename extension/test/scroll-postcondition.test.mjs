/**
 * Constraint: op:input kind:"scroll" owns a MEASURED postcondition — a scroll
 * that moved nothing must FAIL, never return ok:true.
 * Classification: safety / what — ADR 2026-07-20-input-kind-scroll.
 *
 * Why this kind exists at all (2026-07-20 小红书 dogfood): the effect is
 * synthesizable by `hover` + trusted `click` + `press PageDown`, so it fails
 * the OP-membership rule (irreducibility) — but `press` must return ok:true
 * unconditionally, because a keypress HAS no defined effect. A `press End`
 * that landed on the document instead of the scroll container reported success
 * while resetting scrollTop to 0, and the reading agent concluded from that
 * success that the platform blocked deep access. Cost: a false capability
 * boundary written into a memory file as fact. Kinds are admitted for
 * OBSERVABILITY; this test is that admission criterion, executable.
 *
 * Behavioral (extract-and-run, like keys-noop-verify / keytype-verify): both
 * named functions are pulled from background.js source and executed against
 * DOM doubles — no browser, no debugger, so it runs in CI.
 *
 * Phase 1a (adversarial): a half-impl could (a) hardcode "page" and ignore
 * every other amount, (b) return the document scroller unconditionally instead
 * of walking to the nearest scrollable ancestor, or (c) treat overflow:hidden
 * as scrollable. Each is exercised below with a shape that only the correct
 * implementation separates.
 *
 * Phase 1b (anchor): the container shape is the real 小红书 comment pane
 * captured 2026-07-20 — `.note-scroller`, clientHeight 670, scrollHeight 5041,
 * scrollTop 2416 mid-pane; the wheel that finally worked measured
 * before 20 → after 40 comments with scrollHeight 5041 → 7884.
 *
 * Run: node extension/test/scroll-postcondition.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => {
  try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) {
    failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`)
  }
}

/** Pull a named arrow fn's source out of background.js (same extractor shape
 *  as keys-noop-verify.test.mjs). */
function extractArrow(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker.trim()} not found in background.js`)
  const bodyStart = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (!depth) { i++; break } }
  }
  const sigStart = src.indexOf('(', start)
  return src.slice(sigStart, i)
}

const scrollDeltaFor = eval(extractArrow(BG, 'const scrollDeltaFor = '))
const scrollProbe = eval(extractArrow(BG, 'const scrollProbe = '))

console.log('scrollDeltaFor — distance vocabulary')

test('"page" is ~90% of the viewport, floored at 120', () => {
  assert.equal(scrollDeltaFor('page', 670, 5041, 0), 603)
  assert.equal(scrollDeltaFor(undefined, 670, 5041, 0), 603, 'default is "page"')
  assert.equal(scrollDeltaFor('page', 10, 5041, 0), 120, 'tiny pane floors at 120')
})

test('"-page" scrolls up by the same magnitude', () => {
  assert.equal(scrollDeltaFor('-page', 670, 5041, 0), -603)
})

test('"end" asks for the whole REMAINING distance, not a fixed page', () => {
  // Anchored to the real xhs pane: mid-scroll at 2416 of 5041.
  assert.equal(scrollDeltaFor('end', 670, 5041, 2416), 5041 - 2416)
  // Never smaller than a page, even when already near the bottom — otherwise
  // "end" would silently become a no-op and trip the delta-0 failure.
  assert.equal(scrollDeltaFor('end', 670, 5041, 5040), 603)
})

test('signed pixel counts pass through; junk falls back to a page', () => {
  assert.equal(scrollDeltaFor('800', 670, 5041, 0), 800)
  assert.equal(scrollDeltaFor('-400', 670, 5041, 0), -400)
  assert.equal(scrollDeltaFor('banana', 670, 5041, 0), 603, 'unparseable → page')
  assert.equal(scrollDeltaFor('0', 670, 5041, 0), 603, 'explicit 0 would be a guaranteed no-op')
})

console.log('scrollProbe — finds the SCROLLABLE ancestor, not just any ancestor')

/** Minimal DOM double: only what scrollProbe touches. */
function makeDoc({ target, docScroller }) {
  const g = globalThis
  g.innerWidth = 1280
  g.innerHeight = 900
  g.getComputedStyle = (el) => ({ overflowY: el.overflowY ?? 'visible' })
  g.document = {
    body: docScroller.body,
    scrollingElement: docScroller,
    documentElement: docScroller,
    querySelector: (s) => (s === '#t' ? target : null),
  }
}
const el = (o) => ({
  scrollTop: 0, clientHeight: 0, scrollHeight: 0, overflowY: 'visible',
  parentElement: null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  ...o,
})

test('walks past a non-scrollable parent to the real scroller (the xhs shape)', () => {
  const docEl = el({ clientHeight: 900, scrollHeight: 900 })
  docEl.body = el({})
  // .note-scroller: the real captured geometry
  const scroller = el({
    overflowY: 'auto', scrollTop: 2416, clientHeight: 670, scrollHeight: 5041,
    getBoundingClientRect: () => ({ x: 400, y: 100, width: 500, height: 670 }),
  })
  const inner = el({ parentElement: scroller })        // .comments-container
  scroller.parentElement = docEl
  makeDoc({ target: inner, docScroller: docEl })
  const r = scrollProbe('#t')
  assert.equal(r.top, 2416)
  assert.equal(r.clientHeight, 670)
  assert.equal(r.scrollHeight, 5041)
  assert.equal(r.at_bottom, false)
  // Aim point is the scroller's centre, NOT the viewport centre — a wheel at
  // the viewport centre can land outside the pane and scroll the page instead.
  assert.equal(r.x, 650)
  assert.equal(r.y, 435)
})

test('overflow:hidden is NOT scrollable even when the content overflows', () => {
  const docEl = el({ clientHeight: 900, scrollHeight: 4000, overflowY: 'auto' })
  docEl.body = el({})
  const clipped = el({ overflowY: 'hidden', clientHeight: 200, scrollHeight: 3000 })
  const inner = el({ parentElement: clipped })
  clipped.parentElement = docEl
  makeDoc({ target: inner, docScroller: docEl })
  const r = scrollProbe('#t')
  // Falls through to the document scroller, whose aim point is the viewport centre.
  assert.equal(r.clientHeight, 900)
  assert.equal(r.x, 640)
  assert.equal(r.y, 450)
})

test('a container whose content fits is not a scroller (the +4 tolerance)', () => {
  const docEl = el({ clientHeight: 900, scrollHeight: 3000 })
  docEl.body = el({})
  const snug = el({ overflowY: 'auto', clientHeight: 500, scrollHeight: 502 })
  const inner = el({ parentElement: snug })
  snug.parentElement = docEl
  makeDoc({ target: inner, docScroller: docEl })
  assert.equal(scrollProbe('#t').clientHeight, 900, 'a 2px overflow is not a scroll pane')
})

test('at_bottom is true only when pinned (this is the loop terminator)', () => {
  const docEl = el({ clientHeight: 900, scrollHeight: 900 })
  docEl.body = el({})
  const pinned = el({
    overflowY: 'scroll', scrollTop: 4371, clientHeight: 670, scrollHeight: 5041,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 670 }),
  })
  const inner = el({ parentElement: pinned })
  pinned.parentElement = docEl
  makeDoc({ target: inner, docScroller: docEl })
  assert.equal(scrollProbe('#t').at_bottom, true, '4371 + 670 === 5041')
})

test('a missing target throws Element not found (typed miss, not a crash)', () => {
  const docEl = el({ clientHeight: 900, scrollHeight: 900 })
  docEl.body = el({})
  makeDoc({ target: null, docScroller: docEl })
  assert.throws(() => scrollProbe('#nope'), /Element not found/)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)

/**
 * ── Phase 7 post-mortem (2026-07-20, same day) ──────────────────────────
 *
 * The first real end-to-end run found the defect the unit tests could not:
 * scrolling a page that was ALREADY pinned to the bottom aborted the plan with
 *   op:input peer_unreachable: … scroll_no_op: already at the bottom
 *   (scrollTop 9076, clientHeight 761, scrollHeight 9837)
 * and the envelope carried `next.user.kind: reconnect_extension`.
 *
 * TWO defects, one root:
 *  1. ROOT — ADR §2.2 already said "already pinned … is a legitimate terminal
 *     state for a pagination loop, the second [wheel went nowhere] is a bug in
 *     the plan". The prose distinguished them; the CODE threw on both. Being
 *     at the boundary when you asked to scroll to the end IS the postcondition
 *     satisfied, not violated.
 *  2. SYMPTOM — the throw fell through `classifyExtensionError` to
 *     peer_unreachable, telling the operator to reconnect a bridge that was
 *     working perfectly. Identical to the trap tap-core#65 fixed for op:eval.
 *
 * ADVERSARIAL framing (Phase 1a): the cheap "fix" is to stop throwing on
 * delta 0 entirely — which would restore exactly the silent-no-op this whole
 * kind exists to abolish. These constraints pin BOTH sides: at-bottom must
 * SUCCEED, not-at-bottom must still FAIL.
 */
const outcomeFor = (() => {
  const m = BG.indexOf('const scrollOutcome = ')
  if (m === -1) return null
  return eval(extractArrow(BG, 'const scrollOutcome = '))
})()

console.log('scrollOutcome — delta 0 is terminal at a boundary, a failure elsewhere')

test('at the bottom with delta 0 → SUCCESS (the pagination loop terminator)', () => {
  assert.ok(outcomeFor, 'scrollOutcome must be a named extractable fn')
  const r = outcomeFor(0, { top: 9076, clientHeight: 761, scrollHeight: 9837 },
    { top: 9076, at_bottom: true }, 603, 0, 0)
  assert.equal(r.ok, true, 'already-pinned is the postcondition satisfied, not violated')
  assert.equal(r.value.delta, 0)
  assert.equal(r.value.at_bottom, true)
})

test('delta 0 while NOT at a boundary → FAILURE (the whole point of the kind)', () => {
  const r = outcomeFor(0, { top: 120, clientHeight: 670, scrollHeight: 5041 },
    { top: 120, at_bottom: false }, 603, 10, 20)
  assert.equal(r.ok, false, 'a wheel that moved nothing mid-page must not report success')
  assert.match(r.error, /scroll_no_op/)
  assert.match(r.error, /selector_not_found/, 'must classify as a target problem, NOT peer_unreachable')
})

test('a real scroll still succeeds', () => {
  const r = outcomeFor(685, { top: 0, clientHeight: 761, scrollHeight: 9837 },
    { top: 685, at_bottom: false }, 685, 0, 0)
  assert.equal(r.ok, true)
  assert.equal(r.value.delta, 685)
})
