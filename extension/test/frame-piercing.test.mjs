/**
 * Constraint: frame-piercing combinator "<iframe-sel> >>> <inner-sel>" (#62)
 * Classification: safety / what -- violations silently re-blind ops to iframes
 *
 * Every selector-bearing op must reach elements inside iframes. The engine
 * pierces shadow DOM but historically had ZERO iframe support: execFunc always
 * injected { target: { tabId } } (top frame only) and upload's pierced CDP
 * tree can't cross document boundaries with DOM.querySelector.
 *
 * Design constraints locked here:
 *  - frame resolution uses a chrome.scripting allFrames probe whose injection
 *    results carry frameId — NOT chrome.webNavigation, which would add a new
 *    manifest permission (store re-review + user-facing warning).
 *  - plain selectors pass through resolveFrame untouched (no behavior change).
 *  - CDP coordinate ops (trusted click, hover, contenteditable typing) get the
 *    iframe's viewport offset — frame-relative rects are wrong in CDP space.
 *  - upload resolves the inner input via contentDocument → objectId →
 *    DOM.setFileInputFiles; cross-origin (OOPIF) fails with a clear message.
 *
 * Run: node extension/test/frame-piercing.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
const MANIFEST = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf-8'))

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

console.log('\nframe-piercing combinator (#62)\n')

test('resolveFrame helper exists with the " >>> " separator', () => {
  assert(BG_SRC.includes("const FRAME_SEP = ' >>> '"), 'FRAME_SEP literal missing')
  assert(BG_SRC.includes('async function resolveFrame('), 'resolveFrame helper missing')
})

test('frame located via allFrames probe (injection results carry frameId)', () => {
  const body = slice('async function resolveFrame(', 1800)
  assert(body.includes('allFrames: true'), 'must probe with allFrames: true')
  assert(body.includes('frameId'), 'must read frameId from injection results')
})

test('no webNavigation permission added (store re-review + warning)', () => {
  assert(!MANIFEST.permissions.includes('webNavigation'),
    'frame resolution must not require the webNavigation permission')
  assert(!BG_SRC.includes('chrome.webNavigation'),
    'background.js must not call chrome.webNavigation')
})

test('execFunc accepts a { tabId, frameId } target', () => {
  const body = slice('async function execFunc(', 400)
  assert(body.includes('frameIds'), 'execFunc must translate frameId → target.frameIds')
})

test('plain selectors pass through resolveFrame untouched', () => {
  const body = slice('async function resolveFrame(', 600)
  assert(body.includes('if (!sel || !sel.includes(FRAME_SEP)) return'),
    'non-piercing selectors must short-circuit with the original tabId target')
})

test('selector-bearing handlers route through resolveFrame', () => {
  // " {" suffix targets the real handlers, not op:input's kind-dispatch table
  for (const c of ["case 'click': {", "case 'type': {", "case 'fill': {", "case 'setHtml': {",
                   "case 'hover': {", "case 'select': {", "case 'extract': {", "case 'scroll': {"]) {
    const body = slice(c, 700)
    assert(body.includes('resolveFrame('), `${c} must resolve its selector via resolveFrame`)
  }
})

test('CDP coordinate ops translate frame-relative coords (dx/dy)', () => {
  const click = slice("case 'click': {", 3200) // window widened for the visible-match clickResolver (2026-06-11)
  assert(click.includes('result.x + dx'), 'trusted click must offset by iframe viewport position')
  const hover = slice("case 'hover': {", 800)
  assert(hover.includes('coords.x + dx'), 'hover mouseMoved must offset by iframe viewport position')
  const type = slice("case 'type': {", 3600)
  assert(type.includes('probe.x + dx'), 'type keys/contenteditable paths must offset coords')
})

test('waitFor polls frame resolution instead of one-shot throwing', () => {
  const body = slice("case 'waitFor': {", 900)
  assert(body.includes('FRAME_SEP') && body.includes('resolveFrame('),
    'waitFor must treat a resolveFrame probe hit as the wait condition')
})

test('upload pierces same-origin frames via objectId, errors clearly on OOPIF', () => {
  const body = slice("case 'upload': {", 1900)
  assert(body.includes('contentDocument'), 'upload must chain through contentDocument')
  assert(body.includes('objectId'), 'upload must hand the objectId to DOM.setFileInputFiles')
  assert(body.includes('cross-origin iframes are not yet supported'),
    'OOPIF upload must fail with an explicit message, not a generic not-found')
})

test('op:wait selector-mode delegates to waitFor (was silently ignored)', () => {
  const body = slice("case 'wait': {", 1100)
  assert(body.includes("handleMethod('waitFor'"),
    'method wait with a selector must delegate to waitFor, not NaN-ms sleep to instant ok')
  assert(body.includes("'selector_not_found: '"),
    'wait selector timeout must map to the conformance-contracted selector_not_found')
})

test('frame miss surfaces as Element not found (→ selector_not_found wire code)', () => {
  const body = slice('async function resolveFrame(', 1800)
  assert(body.includes("throw new Error('Element not found: "),
    'resolveFrame errors must keep the prefix peer-conformance maps to selector_not_found')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
