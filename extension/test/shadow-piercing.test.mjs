/**
 * Constraint: shadow-piercing — ONE resolver, referenced not copied.
 * Classification: safety / what -- violations silently re-blind ops to shadow DOM
 *                 OR re-introduce the drift this refactor deleted.
 *
 * Chinese enterprise consoles (微信小店, 企业微信后台, aliyun) render their real
 * content inside qiankun-style <micro-app> custom elements whose body lives in an
 * OPEN shadowRoot. Plain document.querySelector can't cross that boundary.
 *
 * The shadow-piercing helpers (formerly inline `deepAll`×3 + `deepControl`×3 — six
 * byte-identical copies a drift-guard had to police) now live ONCE in
 * background.js's TAP_DEEP_INSTALL, installed into the page MAIN world as
 * globalThis.__tapDeep and REFERENCED by every selector-bearing handler. This is
 * the structural fix (R2: kill drift sources, don't guard copies) — the sibling of
 * the iframe combinator (#62, frame-piercing.test.mjs):
 *   iframe  ' >>> '  crosses a DOCUMENT boundary (CDP frameId, resolveFrame)
 *   shadow  ' >> '   crosses a SHADOW-ROOT boundary in-page (__tapDeep.all)
 *
 * Two kinds of constraint here:
 *  1. SOURCE shape — exactly one definition, zero inline copies, handlers wire to
 *     it AFTER ensureDeep installs it. (Brace-matched handler slices, not magic
 *     lengths — the old fixed-length slices broke on every handler resize.)
 *  2. BEHAVIOUR — the REAL shipping helper (imported via _install-deep, extracted
 *     verbatim from background.js) crosses open shadow roots and finds inner
 *     controls. No re-typed copy that could drift from what ships.
 *
 * Phase 1 wires click/type/fill/blur. op:extract is deliberately NOT wired: it runs
 * ENGINE-side (deno-dom over fetched static HTML), never reaches the extension, and
 * static HTML has no shadow roots. setHtml/hover/select/scroll = Phase 1.5. Closed
 * shadow roots (CDP pierce:true) = Phase 2 — SHIPPED 2026-07-10 for trusted clicks
 * (pierceClosedShadowClick; see closed-shadow-pierce.test.mjs).
 *
 * Run: node extension/test/shadow-piercing.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { tapDeep } from './_install-deep.mjs' // the REAL helper, extracted from background.js

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

// Brace-match a `{...}` block starting at `from` — robust to handler resizing
// (the old slice(marker, fixedLength) broke whenever a handler grew/shrank).
function block(from) {
  const start = BG_SRC.indexOf(from)
  assert(start >= 0, `not found: ${from}`)
  const braceStart = BG_SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces after: ${from}`)
}
const countOf = (needle) => BG_SRC.split(needle).length - 1

console.log('\nshadow-piercing — one resolver, referenced not copied\n')

// --- 1. Source shape: single definition, zero copies, wired after install ---

test('exactly ONE resolver definition (TAP_DEEP_INSTALL)', () => {
  assert.equal(countOf('const TAP_DEEP_INSTALL = '), 1,
    'the shadow resolver must be defined exactly once')
})

test('ZERO inline deepAll / deepControl copies remain (drift deleted, not guarded)', () => {
  assert.equal(countOf('const deepAll = (sel, root) =>'), 0, 'no inline deepAll copies may remain')
  assert.equal(countOf('const deepControl = (n, d) =>'), 0, 'no inline deepControl copies may remain')
})

test('the resolver crosses shadow via " >> " split + .shadowRoot', () => {
  const inst = block('const TAP_DEEP_INSTALL = ')
  assert(inst.includes("' >> '"), 'all() must split the selector on the " >> " literal')
  assert(inst.includes('.shadowRoot'), 'must descend into element.shadowRoot')
  assert(inst.includes('globalThis.__tapDeep'), 'must publish the resolver on globalThis.__tapDeep')
})

test('every selector-bearing handler installs (ensureDeep) BEFORE referencing __tapDeep', () => {
  for (const c of ["case 'click': {", "case 'type': {", "case 'fill': {", "case 'blur': {"]) {
    const body = block(c)
    const install = body.indexOf('ensureDeep(fx)')
    const use = body.indexOf('__tapDeep.')
    assert(install >= 0, `${c} must call ensureDeep(fx)`)
    assert(use >= 0, `${c} must reference __tapDeep`)
    assert(install < use, `${c} must ensureDeep BEFORE referencing __tapDeep (else the global is undefined)`)
  }
})

test('op:extract is NOT wired for shadow piercing (engine-side, would be dead)', () => {
  assert(!block("case 'extract': {").includes('__tapDeep'),
    'extract runs engine-side (deno-dom) and never reaches the extension — must stay plain')
})

// --- 2. Behaviour: run the REAL shipping helper (no re-typed copy) ---

function mkRoot(map) {
  return { querySelectorAll: (s) => map[s] || [], querySelector: (s) => (map[s] || [])[0] || null }
}

test('all("<host> >> <inner>") crosses an open shadow root to the inner element', () => {
  const btn = { tagName: 'BUTTON', id: 'btn' }
  const host = { tagName: 'MICRO-APP', shadowRoot: mkRoot({ 'button.foo': [btn] }) }
  const doc = mkRoot({ 'micro-app': [host], 'div.plain': [{ id: 'd' }] })
  const r = tapDeep.all('micro-app >> button.foo', doc)
  assert(r.length === 1 && r[0] === btn, 'must return the button inside the shadow root')
})

test('all(plain selector) reduces to plain querySelectorAll (no behavior change)', () => {
  const d = { id: 'd' }
  const r = tapDeep.all('div.plain', mkRoot({ 'div.plain': [d], '*': [] }))
  assert(r.length === 1 && r[0] === d, 'plain selector must pass through to querySelectorAll')
})

test('all(plain selector) AUTO-descends open shadow roots when the light DOM has zero matches', () => {
  // The 微信小店 case: <span.page> tabs live inside a web-component open shadowRoot,
  // 0 matches at document level. A plain selector must fall back to a deep walk.
  const tab = { tagName: 'SPAN', className: 'page' }
  const host = { tagName: 'MICRO-APP', shadowRoot: mkRoot({ 'span.page': [tab], '*': [] }) }
  const doc = mkRoot({ 'span.page': [], '*': [host] }) // 0 light-DOM matches + one shadow host
  const r = tapDeep.all('span.page', doc)
  assert(r.length === 1 && r[0] === tab, 'plain selector must fall back to shadow descent on a 0-match')
})

test('all(plain selector) does NOT descend shadow when the light DOM already matches (determinism)', () => {
  // Guard: fallback fires ONLY on 0-match. A light-DOM hit must win unchanged, so no
  // existing tap silently starts resolving a deeper shadow element (replay drift).
  const light = { id: 'light' }
  const deep = { id: 'deep' }
  const host = { tagName: 'MICRO-APP', shadowRoot: mkRoot({ 'div.x': [deep], '*': [] }) }
  const doc = mkRoot({ 'div.x': [light], '*': [host] })
  const r = tapDeep.all('div.x', doc)
  assert(r.length === 1 && r[0] === light, 'existing light-DOM match must win — no shadow descent')
})

test('all(" >> " chain) with a 0-match final segment does NOT trigger the auto-fallback', () => {
  // Explicit chains keep their exact scoped semantics — a miss stays a miss, never
  // silently widens to a whole-page deep walk (that would defeat the author's intent).
  const host = { tagName: 'MICRO-APP', shadowRoot: mkRoot({ 'button.gone': [], '*': [] }) }
  const doc = mkRoot({ 'micro-app': [host], 'button.gone': [{ id: 'elsewhere' }] })
  assert.deepEqual(tapDeep.all('micro-app >> button.gone', doc), [],
    'a scoped chain miss must stay [] — no fallback to a global deep walk')
})

test('all() on a missing shadowRoot returns [] (graceful, no throw)', () => {
  const host = { tagName: 'MICRO-APP', shadowRoot: null } // closed/absent
  assert.deepEqual(tapDeep.all('micro-app >> button.foo', mkRoot({ 'micro-app': [host] })), [],
    'an unreachable (closed/absent) shadow root must yield [] not a crash')
})

test('control() finds an inner form control nested across open shadow roots (recursion)', () => {
  const inp = { tagName: 'INPUT' }
  const subHost = { tagName: 'X-INNER', shadowRoot: mkRoot({ 'input, textarea, select': [inp] }) }
  const host = { tagName: 'MICRO-APP', shadowRoot: mkRoot({ '*': [subHost] }) } // no direct input → recurse
  assert.equal(tapDeep.control(host, 0), inp, 'control must recurse into nested shadow roots to the <input>')
})

test('control() returns the element itself when it is already a form control', () => {
  const inp = { tagName: 'INPUT' }
  assert.equal(tapDeep.control(inp, 0), inp, 'an INPUT host needs no piercing')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
