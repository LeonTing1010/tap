/**
 * Constraint: a click on an inViewport-vetoed but otherwise-valid target
 * SELF-HEALS by scrolling — it must not surface as selector_not_found.
 * Classification: quality / what — resolution completeness at act time.
 *
 * Why (2026-07-23 wxamp submit-review dogfood): the schema markets
 * inViewport as "precondition for a trusted CDP click", so authors add it —
 * then the below-fold 提交审核 button fails resolution outright, even though
 * click's own contract scrolls the target to center before acting anyway.
 * A below-fold match is one scroll away, not a miss.
 *
 * Pins:
 *   1. the heal lives in clickResolver's OBJECT arm only (op:wait keeps
 *      observing — auto-scroll there would make inViewport waits trivially
 *      true);
 *   2. it re-resolves with inViewport:false, scrolls, re-checks vis;
 *   3. behavioral: a below-viewport button resolves and gets clicked after
 *      the heal, with scrollIntoView actually invoked.
 *
 * Run: node extension/test/click-inviewport-selfheal.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { tapDeep } from './_install-deep.mjs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

const resolverSrc = BG_SRC.slice(BG_SRC.indexOf('const clickResolver = (t, probe) => {'), BG_SRC.indexOf('let result'))
assert(resolverSrc.length > 100, 'clickResolver must exist')

test('heal is scoped to the resolver-object arm of clickResolver', () => {
  assert(/if \(!el && t\.inViewport\) \{/.test(resolverSrc), 'heal gate must be a miss WITH inViewport declared')
  assert(/pickVoted\(\{ \.\.\.t, inViewport: false \}, document\)/.test(resolverSrc),
    'heal must re-resolve with ONLY the viewport veto relaxed')
  assert(/scrollIntoView\(\{ block: 'center', behavior: 'instant' \}\)/.test(resolverSrc),
    'heal must scroll the survivor to center')
  assert(/if \(vis\(relaxed\.el\)\) \{ el = relaxed\.el; witness = relaxed\.witness \}/.test(resolverSrc),
    'heal must accept the survivor only if it actually renders')
})

test('op:wait path has NO scroll heal (inViewport wait semantics preserved)', () => {
  const waitForCase = BG_SRC.slice(BG_SRC.indexOf("case 'waitFor': {"), BG_SRC.indexOf("case 'waitForNetwork': {"))
  assert(!/scrollIntoView/.test(waitForCase), 'waitFor must never scroll to satisfy its own condition')
})

// ── behavioral: below-fold button heals and clicks ─────────────────────────

function extractClickResolver() {
  const start = BG_SRC.indexOf('const clickResolver = (t, probe) => {')
  const fnStart = BG_SRC.indexOf('(t, probe)', start)
  let i = BG_SRC.indexOf('{', fnStart)
  let depth = 0, end = i
  for (; end < BG_SRC.length; end++) {
    const c = BG_SRC[end]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  return new Function(`return (t, probe) => ${BG_SRC.slice(i, end + 1)}`)()
}

function stubButton({ top }) {
  const el = {
    tagName: 'BUTTON',
    textContent: '提交审核',
    children: [],
    scrolled: 0,
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    getBoundingClientRect: () => ({
      x: 10, y: el._top, width: 100, height: 30,
      top: el._top, bottom: el._top + 30, left: 10, right: 110,
    }),
    scrollIntoView() { el.scrolled++; el._top = 300 }, // brings it into the 800px viewport
    dispatchEvent: () => true,
    focus: () => {},
    click() { el.clickedCount = (el.clickedCount || 0) + 1 },
    _top: top,
  }
  return el
}

test('below-viewport button: vetoed → healed → clicked (coords post-scroll)', () => {
  const g = globalThis
  const prev = {
    document: g.document, getComputedStyle: g.getComputedStyle,
    innerHeight: g.innerHeight, innerWidth: g.innerWidth,
    PointerEvent: g.PointerEvent, MouseEvent: g.MouseEvent, window: g.window,
  }
  try {
    const btn = stubButton({ top: 2000 }) // far below an 800px viewport
    g.innerHeight = 800
    g.innerWidth = 1200
    g.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    g.document = {
      documentElement: {},
      querySelectorAll: (sel) => (sel === 'button.btn_primary' || sel === '*') ? (sel === '*' ? [] : [btn]) : [],
      createTreeWalker: () => ({ nextNode: () => null }),
    }
    g.window = undefined
    const clickResolver = extractClickResolver()
    const target = { selector: 'button.btn_primary', text: '提交审核', visible: true, inViewport: true }
    // Sanity: without the heal this target must MISS (inViewport veto).
    assert.equal(tapDeep.pick(target, g.document), null, 'pre-heal pick must veto the below-fold match')
    const r = clickResolver(target, false)
    assert.equal(r.clicked, true, 'healed click must succeed')
    assert(btn.scrolled >= 1, 'scrollIntoView must have been invoked by the heal')
    assert.equal(btn.clickedCount, 1, 'exactly one click must dispatch')
    assert(r.y <= 800, 'returned coords must be post-scroll (inside the viewport)')
  } finally {
    Object.assign(g, prev)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
