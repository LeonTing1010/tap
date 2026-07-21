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
  const click = slice("case 'click': {", 8000) // widened: visible-match clickResolver (2026-06-11) + probe-mode branch (Clause B, 2026-06-17) + inline deepAll shadow helper (2026-06-23) + closed-shadow pierce fallback (Phase 2, 2026-07-10) + witness-voting report (ADR 2026-07-17) + 6400->8000 full one-click pointer sequence (ADR 2026-07-21)
  assert(click.includes('result.x + dx'), 'trusted click must offset by iframe viewport position')
  const hover = slice("case 'hover': {", 1000) // widened 800->1000: the selector-miss message now carries the iframe ' >>> ' hint (2026-07-16)
  assert(hover.includes('coords.x + dx'), 'hover mouseMoved must offset by iframe viewport position')
  const type = slice("case 'type': {", 4300)
  assert(type.includes('probe.x + dx'), 'type keys/contenteditable paths must offset coords')
})

test('waitFor polls frame resolution instead of one-shot throwing', () => {
  const body = slice("case 'waitFor': {", 900)
  assert(body.includes('FRAME_SEP') && body.includes('resolveFrame('),
    'waitFor must treat a resolveFrame probe hit as the wait condition')
})

test('upload pierces same-origin frames via objectId, errors clearly on OOPIF', () => {
  // window widened 1900 -> 4600: the L2 trusted chooser-intercept branch
  // (2026-07-02) now precedes the frame-piercing branch inside the case.
  const body = slice("case 'upload': {", 4600)
  assert(body.includes('contentDocument'), 'upload must chain through contentDocument')
  assert(body.includes('objectId'), 'upload must hand the objectId to DOM.setFileInputFiles')
  assert(body.includes('cross-origin iframes are not yet supported'),
    'OOPIF upload must fail with an explicit message, not a generic not-found')
})

test('upload trusted path intercepts the file chooser and clicks the trigger', () => {
  const body = slice("case 'upload': {", 4600)
  assert(body.includes('Page.setInterceptFileChooserDialog'),
    'trusted upload must arm chooser interception before clicking')
  assert(body.includes('Page.fileChooserOpened'),
    'trusted upload must resolve the input from the chooser event')
  assert(body.includes('backendNodeId'),
    'trusted upload must feed files to the browser-reported node')
  // listener must be armed BEFORE the trusted click fires (race guard)
  const armIdx = body.indexOf('chrome.debugger.onEvent.addListener(onEvt)')
  const clickIdx = body.indexOf('cdpClick(tabId, pt.x + dx')
  assert(armIdx >= 0 && clickIdx > armIdx,
    'chooser listener must be registered before cdpClick dispatches')
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

// ── reachability diagnosis: a bare selector that misses in the top document
//    but exists inside a SAME-ORIGIN iframe must be tagged [reach=in_frame]
//    (→ core suggests the ' >>> ' fix), NOT `absent` (→ wrongly says re-capture).
//    This is the AGC-console class: querySelector never crosses iframe document
//    boundaries, so the fix is the frame combinator, not drift.
function extractArrowConst(name) {
  const marker = `const ${name} = `
  const start = BG_SRC.indexOf(marker)
  assert(start >= 0, `${marker} not found in background.js`)
  const braceStart = BG_SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(BG_SRC.indexOf('=', start) + 1, i + 1).trim() }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

test('DIAGNOSE_REACHABILITY tags a same-origin iframe target as in_frame (behavioral)', () => {
  const arrow = extractArrowConst('DIAGNOSE_REACHABILITY')
  const node = { tagName: 'DIV' }
  const mkDoc = (hit, crossOrigin) => ({
    querySelectorAll: (s) => s === 'iframe' ? [{
      get contentDocument() {
        if (crossOrigin) throw new Error('cross-origin: blocked')
        return { querySelector: (sel) => (hit && sel === '.target') ? node : null }
      },
    }] : [],
  })
  const bind = (doc) => new Function('document', `return (${arrow})`)(doc)
  const prev = globalThis.__tapDeep
  globalThis.__tapDeep = { pick: () => null } // top-doc host absent → forces the iframe probe
  try {
    assert.deepEqual(bind(mkDoc(true, false))({ selector: '.target' }), { reach: 'in_frame' },
      'same-origin iframe hit must tag in_frame')
    assert.deepEqual(bind(mkDoc(false, false))({ selector: '.target' }), { reach: 'absent' },
      'no iframe hit → absent (real drift)')
    assert.deepEqual(bind(mkDoc(true, true))({ selector: '.target' }), { reach: 'absent' },
      'cross-origin frame throws on contentDocument → best-effort falls through to absent')
  } finally {
    globalThis.__tapDeep = prev
  }
})

test('DIAGNOSE probes iframe contentDocument before declaring absent (source)', () => {
  const body = slice('const DIAGNOSE_REACHABILITY', 1500)
  assert(body.includes('contentDocument'), 'must probe iframe contentDocument')
  assert(body.includes("reach: 'in_frame'"), 'must tag in_frame on an iframe hit')
})

test('misdirecting "page not ready" wording replaced with the frame >>> hint', () => {
  assert(!BG_SRC.includes('page not ready'),
    'the misdirecting "page not ready" wording (blames timing for a scope error) must be gone')
  assert(BG_SRC.includes('iframeSel >>> innerSel'),
    'selector-miss messages must hint the frame combinator')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
