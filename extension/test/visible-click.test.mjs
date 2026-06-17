/**
 * Constraint: op:input click resolves to a VISIBLE/interactable element.
 * Classification: safety / what — violations destroy state (clicked a hidden
 * "退出登录" in the 2026-06-11 weixin menu dogfood → logged the session out).
 *
 * This is BEHAVIORAL, not structural: it extracts the click handler's injected
 * page-function from background.js source and executes it against a DOM double
 * where document.querySelector(sel)'s FIRST match is hidden (display:none) and
 * a later match is visible. The constraint: the visible element is the one that
 * receives .click().
 *
 * Phase 1a (adversarial): a half-impl that adds a visibility helper but still
 * clicks `document.querySelector(t)` (first match) would pass any grep for
 * "getComputedStyle". This test catches that shortcut because it RUNS the real
 * source against a DOM where first-match===hidden and asserts the *visible*
 * node was clicked — a first-match impl returns the hidden node and fails.
 *
 * Phase 1b (anchor): the DOM shape (hidden primary button preceding a visible
 * one sharing a class) is the exact real shape from the weixin self-menu editor
 * (`.weui-desktop-btn_primary` first match = hidden 退出登录, second = visible
 * 保存并发布) captured 2026-06-11.
 *
 * Run: node extension/test/visible-click.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// --- Extract the named click resolver injected into the page (GREEN adds it). ---
// Marker contract: `const clickResolver = (t) => { ... }` inside the click case.
function extractClickResolver(src) {
  const marker = 'const clickResolver = '
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('clickResolver not found — click handler must define a named, self-contained `const clickResolver = (t) => {…}` resolver (so it injects AND is testable)')
  // brace-match from the arrow body
  const arrowBodyStart = src.indexOf('{', start)
  let depth = 0, i = arrowBodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { i++; break } }
  }
  const fnSrc = src.slice(src.indexOf('(', start), i) // (t[, probe]) => { ... }
  return fnSrc
}

// --- Minimal DOM double ---
function makeEl(id, { display = 'block', w = 40, h = 20, text = '', aria = '' } = {}) {
  return {
    __id: id, __clicked: false, __display: display,
    textContent: text, children: [],
    getAttribute: (k) => (k === 'aria-label' ? aria : null),
    scrollIntoView() {},
    click() { this.__clicked = true },
    getBoundingClientRect() { return { x: 0, y: 0, width: w, height: h } },
  }
}

console.log('\n  -- op:input click prefers the visible match --\n')

const resolverSrc = (() => { try { return extractClickResolver(BG_SRC) } catch (e) { return null } })()

test('clickResolver exists as a self-contained named injected fn', () => {
  assert(resolverSrc, 'background.js must define `const clickResolver = (t) => {…}`')
})

test('first match hidden, second visible → clicks the VISIBLE one', () => {
  assert(resolverSrc, 'resolver missing (see prior failure)')
  const hidden = makeEl('hidden', { display: 'none' })   // querySelector first match
  const visible = makeEl('visible', { display: 'block' }) // later sibling, same selector
  const all = [hidden, visible]
  const fakeDoc = {
    body: {},
    querySelector: () => all[0],
    querySelectorAll: () => all,
    createTreeWalker: () => ({ nextNode: () => null }),
  }
  const fakeGetStyle = (el) => ({ display: el.__display, visibility: 'visible', opacity: '1' })
  const NodeFilterStub = { SHOW_ELEMENT: 1 }
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter', `return (${resolverSrc})`)
  const resolver = factory(fakeDoc, fakeGetStyle, NodeFilterStub)
  resolver('.weui-desktop-btn_primary')
  assert(!hidden.__clicked, 'must NOT click the hidden first match (the 退出登录 footgun)')
  assert(visible.__clicked, 'must click the visible match')
})

test('single visible match → unchanged behavior (clicks it)', () => {
  assert(resolverSrc, 'resolver missing')
  const only = makeEl('only', { display: 'block' })
  const fakeDoc = { body: {}, querySelector: () => only, querySelectorAll: () => [only], createTreeWalker: () => ({ nextNode: () => null }) }
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter', `return (${resolverSrc})`)
  factory(fakeDoc, (el) => ({ display: el.__display, visibility: 'visible', opacity: '1' }), { SHOW_ELEMENT: 1 })('.x')
  assert(only.__clicked, 'single visible match must still be clicked')
})

// --- probe mode (resolve-before-dispatch gate, Clause B click half) ---
// clickResolver(t, true) resolves via click's EXACT chain (incl. the semantic
// text/aria fallback op:wait lacks) but returns { resolved } WITHOUT clicking.
console.log('\n  -- op:input click probe mode (resolve, do not click) --\n')

test('probe mode resolves a semantic-text-only target WITHOUT clicking', () => {
  assert(resolverSrc, 'resolver missing')
  const btn = makeEl('btn', { display: 'block', text: '立即打卡' })
  const fakeDoc = {
    body: {},
    querySelector: () => null,                                       // literal selector misses
    querySelectorAll: (s) => (String(s).includes('button') ? [btn] : []), // semantic scan finds it
    createTreeWalker: () => ({ nextNode: () => null }),
  }
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter', `return (${resolverSrc})`)
  const resolver = factory(fakeDoc, (el) => ({ display: el.__display, visibility: 'visible', opacity: '1' }), { SHOW_ELEMENT: 1 })
  const out = resolver('立即打卡', true)
  assert(out && out.resolved === true, 'probe must resolve the semantic target (got ' + JSON.stringify(out) + ')')
  assert(!btn.__clicked, 'probe must NOT click')
})

test('probe mode on a miss returns {resolved:false} and does NOT throw', () => {
  assert(resolverSrc, 'resolver missing')
  const fakeDoc = { body: {}, querySelector: () => null, querySelectorAll: () => [], createTreeWalker: () => ({ nextNode: () => null }) }
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter', `return (${resolverSrc})`)
  const resolver = factory(fakeDoc, () => ({ display: 'block', visibility: 'visible', opacity: '1' }), { SHOW_ELEMENT: 1 })
  let out, threw = false
  try { out = resolver('nope', true) } catch { threw = true }
  assert(!threw, 'probe must not throw on miss')
  assert(out && out.resolved === false, 'probe returns {resolved:false} on miss')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
