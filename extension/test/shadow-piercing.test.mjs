/**
 * Constraint: shadow-piercing combinator "<host-sel> >> <inner-sel>"
 * Classification: safety / what -- violations silently re-blind ops to shadow DOM
 *
 * Chinese enterprise consoles (微信小店, 企业微信后台, aliyun) render their real
 * content inside qiankun-style <micro-app> custom elements whose body lives in an
 * OPEN shadowRoot. Plain `document.querySelector(sel)` cannot cross that boundary,
 * so click/type/fill/extract were blind to everything inside — the dogfood that
 * forced this: reading 微信小店 客服管理/关联账号 needed a hand-written op:eval that
 * walked `.shadowRoot` recursively (op:eval is value-only, so it could observe but
 * never click/fill inside the shadow tree).
 *
 * Sibling to the iframe combinator (#62, frame-piercing.test.mjs):
 *  - iframe  ' >>> '  crosses a DOCUMENT boundary (CDP frameId hop, background side)
 *  - shadow  ' >> '   crosses a SHADOW-ROOT boundary (in-page, inside the injected fn)
 * resolveFrame strips ' >>> ' first, so the ' >> ' split inside deepAll is unambiguous
 * (' >> ' is not a substring of ' >>> ', and neither is valid CSS).
 *
 * Design constraints locked here:
 *  - deepAll is INLINE + self-contained in each handler (NOT a window global): the
 *    handlers are extracted and executed in isolation by visible-click.test.mjs via
 *    `new Function(...)`, so they must not reference outer scope. The 4 inline copies
 *    are byte-identical (drift-guarded below) — duplication is machine-checked, not
 *    trusted to memory (engineering-philosophy Standard 1).
 *  - plain selectors (no ' >> ') reduce to plain querySelectorAll → zero behavior
 *    change for every existing tap.
 *  - only OPEN shadow roots are reachable (browser limit: closed roots expose no
 *    .shadowRoot). CDP `pierce:true` for closed roots is Phase 2.
 *  - Phase 1 wires click/type/fill. op:extract is deliberately NOT wired: in the
 *    live pipeline it runs ENGINE-side (deno-dom over fetched static HTML), never
 *    reaches the extension, and static HTML has no shadow roots — a ' >> ' there
 *    would be dead on the live path. setHtml/hover/select/scroll = Phase 1.5.
 *
 * Run: node extension/test/shadow-piercing.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

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

function slice(marker, len) {
  const i = BG_SRC.indexOf(marker)
  assert(i >= 0, `marker not found: ${marker}`)
  return BG_SRC.slice(i, i + len)
}

// Brace-match an arrow body starting at `const deepAll = (sel, root) => {`
// from a given index. Mirrors visible-click.test.mjs's extractClickResolver.
const DEEP_MARKER = 'const deepAll = (sel, root) => '
function extractDeepAllAt(start) {
  const arrowBodyStart = BG_SRC.indexOf('{', start)
  let depth = 0, i = arrowBodyStart
  for (; i < BG_SRC.length; i++) {
    const c = BG_SRC[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return BG_SRC.slice(BG_SRC.indexOf('(', start), i) // (sel, root) => { ... }
}
function allDeepAllStarts() {
  const out = []
  let i = BG_SRC.indexOf(DEEP_MARKER)
  while (i >= 0) { out.push(i); i = BG_SRC.indexOf(DEEP_MARKER, i + 1) }
  return out
}
const norm = (s) => s.replace(/\s+/g, ' ').trim()

console.log('\nshadow-piercing combinator " >> "\n')

// --- Source-shape constraints ---

test('deepAll is inlined in at least the 3 Phase-1 handlers', () => {
  const starts = allDeepAllStarts()
  assert(starts.length >= 3, `expected >=3 inline deepAll copies, found ${starts.length}`)
})

test('all inline deepAll copies are byte-identical (drift-guarded)', () => {
  const starts = allDeepAllStarts()
  assert(starts.length >= 3, `need >=3 copies first (found ${starts.length})`)
  const canonical = norm(extractDeepAllAt(starts[0]))
  for (const s of starts) {
    assert(norm(extractDeepAllAt(s)) === canonical,
      'inline deepAll copies have drifted — they must stay byte-identical')
  }
})

test('deepAll splits on the " >> " shadow separator (not CSS, not " >>> ")', () => {
  const body = extractDeepAllAt(allDeepAllStarts()[0])
  assert(body.includes("' >> '"), "deepAll must split the selector on the ' >> ' literal")
})

test('deepAll crosses .shadowRoot for non-terminal segments', () => {
  const body = extractDeepAllAt(allDeepAllStarts()[0])
  assert(body.includes('.shadowRoot'), 'deepAll must descend into element.shadowRoot')
})

test('Phase-1 handlers resolve their selector via deepAll', () => {
  for (const [c, len] of [["case 'click': {", 2400], ["case 'type': {", 1200],
                          ["case 'fill': {", 1200]]) {
    const body = slice(c, len)
    assert(body.includes('deepAll('), `${c} must resolve its selector through deepAll`)
  }
})

test('op:extract is NOT wired for shadow piercing (engine-side, would be dead)', () => {
  const body = slice("case 'extract': {", 1400)
  assert(!body.includes('deepAll('),
    'extract must stay plain querySelectorAll — it runs engine-side, never reaching the extension')
})

test('click/type/fill no longer resolve the primary target via plain document.querySelector', () => {
  // The light-DOM heuristics (semantic text fallback, treewalker, keysLanded verify)
  // legitimately keep document.querySelector; the PRIMARY resolve must be deepAll.
  const click = slice("case 'click': {", 2400)
  assert(!/let el = document\.querySelector\(t\)/.test(click),
    'click primary resolve must use deepAll, not document.querySelector(t)')
  const type = slice("case 'type': {", 1200)
  assert(!/const el = document\.querySelector\(sel\)/.test(type),
    'type primary resolve must use deepAll')
  const fill = slice("case 'fill': {", 1200)
  assert(!/const el = document\.querySelector\(sel\)/.test(fill),
    'fill primary resolve must use deepAll')
})

// --- Behavioral constraints: extract the REAL inline deepAll and execute it ---

function mkRoot(map) {
  return { querySelectorAll: (s) => map[s] || [], querySelector: (s) => (map[s] || [])[0] || null }
}
function makeDeepAll(documentDouble) {
  const src = extractDeepAllAt(allDeepAllStarts()[0])
  return new Function('document', `return (${src})`)(documentDouble)
}

test('"<host> >> <inner>" crosses an open shadow root to the inner element', () => {
  const btn = { tagName: 'BUTTON', id: 'btn' }
  const shadow = mkRoot({ 'button.foo': [btn] })
  const host = { tagName: 'MICRO-APP', shadowRoot: shadow }
  const doc = mkRoot({ 'micro-app': [host], 'div.plain': [{ id: 'd' }] })
  const deepAll = makeDeepAll(doc)
  const r = deepAll('micro-app >> button.foo')
  assert(r.length === 1 && r[0] === btn, 'must return the button inside the shadow root')
})

test('plain selector (no " >> ") reduces to plain querySelectorAll (no behavior change)', () => {
  const d = { id: 'd' }
  const doc = mkRoot({ 'div.plain': [d] })
  const deepAll = makeDeepAll(doc)
  const r = deepAll('div.plain')
  assert(r.length === 1 && r[0] === d, 'plain selector must pass through to querySelectorAll')
})

test('missing shadowRoot on a non-terminal host returns [] (graceful, no throw)', () => {
  const host = { tagName: 'MICRO-APP', shadowRoot: null } // closed/none
  const doc = mkRoot({ 'micro-app': [host] })
  const deepAll = makeDeepAll(doc)
  assert.deepEqual(deepAll('micro-app >> button.foo'), [],
    'an unreachable (closed/absent) shadow root must yield [] not a crash')
})

test('explicit root arg scopes the query (helper capability)', () => {
  const cell = { id: 'x1' }
  const rowEl = mkRoot({ '.v': [cell] })
  const deepAll = makeDeepAll(mkRoot({})) // document double is empty on purpose
  const r = deepAll('.v', rowEl)
  assert(r.length === 1 && r[0] === cell, 'deepAll(sel, root) must query within root, not document')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
