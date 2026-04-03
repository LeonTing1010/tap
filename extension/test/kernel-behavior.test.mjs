/**
 * Constraint: kernel behavioral correctness
 * Classification: safety / what — violations cause silent failures on real sites
 *
 * Why: architecture tests check structural purity (no CDP in stdlib, etc.)
 * but never ask "does a click actually click on React apps?" These constraints
 * verify the implementation patterns that make kernel primitives behaviorally
 * correct — discovered via real-world failures on X, Dev.to, Juejin.
 *
 * Run: node extension/test/kernel-behavior.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const PROTOCOL_SRC = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')
const BACKGROUND_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
const INSPECT_SRC = readFileSync(new URL('../../src/inspect.ts', import.meta.url), 'utf-8')

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

// ═══════════════════════════════════════════════════════════
// Rule 1: CDP Click — full pointer event chain
// Why: React (and other frameworks) use event delegation. mouseover/mouseenter
// fires during mouseMoved and registers the target. Without it, mousePressed
// + mouseReleased dispatch CDP events but React's onClick never fires.
// Discovered: X/Twitter Post button silently ignored 3 clicks.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: CDP Click Event Chain ──\n')

test('cdpClick dispatches mouseMoved before mousePressed', () => {
  const cdpClick = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf('async function cdpClick'),
    BACKGROUND_SRC.indexOf('async function cdpClick') + 500
  )
  const movedIdx = cdpClick.indexOf('mouseMoved')
  const pressedIdx = cdpClick.indexOf('mousePressed')
  assert(movedIdx !== -1, 'cdpClick must dispatch mouseMoved')
  assert(movedIdx < pressedIdx, 'mouseMoved must come before mousePressed')
})

test('_fallbackClick dispatches mouseMoved before mousePressed', () => {
  const fallback = PROTOCOL_SRC.substring(
    PROTOCOL_SRC.indexOf('async function _fallbackClick'),
    PROTOCOL_SRC.indexOf('async function _fallbackClick') + 500
  )
  const movedIdx = fallback.indexOf('mouseMoved')
  const pressedIdx = fallback.indexOf('mousePressed')
  assert(movedIdx !== -1, '_fallbackClick must dispatch mouseMoved')
  assert(movedIdx < pressedIdx, 'mouseMoved must come before mousePressed')
})

// ═══════════════════════════════════════════════════════════
// Rule 2: Keyboard — correct virtual key codes
// Why: CDP windowsVirtualKeyCode for letter keys must be uppercase ASCII
// (65 for 'A', not 97 for 'a'). Wrong code = Chrome ignores modifier combos.
// Discovered: Cmd+A (select all) silently failed on contenteditable.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 2: Keyboard Key Codes ──\n')

test('keyboard uses uppercase charCode for virtual key codes', () => {
  const keyboardFn = PROTOCOL_SRC.substring(
    PROTOCOL_SRC.indexOf('async keyboard('),
    PROTOCOL_SRC.indexOf('async nav(')
  )
  assert(keyboardFn.includes('toUpperCase().charCodeAt'),
    'windowsVirtualKeyCode must use toUpperCase().charCodeAt(0) — lowercase codes are ignored by Chrome')
})

// ═══════════════════════════════════════════════════════════
// Rule 3: Keyboard — modifier commands
// Why: CDP keyDown with Meta modifier alone doesn't execute browser shortcuts.
// Chrome requires `commands: ['selectAll']` in the event params for Cmd+A
// to actually select all. Without it, the key event fires but nothing happens.
// Discovered: Cmd+A in type() couldn't clear contenteditable on X.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: Keyboard Modifier Commands ──\n')

test('keyboard passes commands array for modifier combos', () => {
  const keyboardFn = PROTOCOL_SRC.substring(
    PROTOCOL_SRC.indexOf('async keyboard('),
    PROTOCOL_SRC.indexOf('async nav(')
  )
  assert(keyboardFn.includes('commands'),
    'keyboard must build and pass commands array for modifier key combos')
})

test('keyboard maps Meta+A to selectAll command', () => {
  const keyboardFn = PROTOCOL_SRC.substring(
    PROTOCOL_SRC.indexOf('async keyboard('),
    PROTOCOL_SRC.indexOf('async nav(')
  )
  assert(keyboardFn.includes('selectAll'),
    'Meta+A must map to selectAll command')
})

test('keyDown events include commands in dispatch', () => {
  const keyboardFn = PROTOCOL_SRC.substring(
    PROTOCOL_SRC.indexOf('async keyboard('),
    PROTOCOL_SRC.indexOf('async nav(')
  )
  // Find keyDown dispatches in press/down branches (not type/insertText)
  const pressSection = keyboardFn.substring(keyboardFn.indexOf("// 'press'"))
  assert(pressSection.includes('commands'),
    'keyDown dispatch in press action must include commands array')
})

// ═══════════════════════════════════════════════════════════
// Rule 4: Eval — scope isolation
// Why: tap.eval runs user expressions via (0, eval)(expr) in global scope.
// const/let at global scope can't be redeclared — second call with same
// variable name throws SyntaxError. Block wrapping { expr } scopes them.
// Discovered: second tap.eval with `const editor` threw SyntaxError on X.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Eval Scope Isolation ──\n')

test('tap.eval wraps expression in block scope', () => {
  const evalCase = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf("case 'tap.eval'"),
    BACKGROUND_SRC.indexOf("case 'tap.eval'") + 600
  )
  assert(evalCase.includes("'{\\n'") || evalCase.includes("'\\n}'") || evalCase.includes("'{\\n' + params.expression") || evalCase.includes("'\\n' + params.expression + '\\n}'"),
    'tap.eval must wrap expression in block scope { } to prevent const/let pollution')
})

test('routeCDP Runtime.evaluate wraps expression in block scope', () => {
  const evalRoute = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf("case 'Runtime.evaluate'"),
    BACKGROUND_SRC.indexOf("case 'Runtime.evaluate'") + 800
  )
  assert(evalRoute.includes('safeExpr'),
    'Runtime.evaluate must use block-scoped expression')
})

// ═══════════════════════════════════════════════════════════
// Rule 5: Tab Recovery — requireTab validates existence
// Why: when a tab is manually closed, its ID becomes stale. Using a stale
// tabId throws "No tab with id: X" on every subsequent call with no recovery.
// routeCDP already had this pattern; requireTab was missing it.
// Discovered: user closed X compose tab → all subsequent calls crashed.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 5: Tab Recovery ──\n')

test('requireTab validates tab still exists', () => {
  const requireTab = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf('async function requireTab'),
    BACKGROUND_SRC.indexOf('async function requireTab') + 400
  )
  assert(requireTab.includes('tabs.get'),
    'requireTab must call chrome.tabs.get() to verify tab exists before using it')
})

test('requireTab and routeCDP both recover from dead tabs', () => {
  // Extract full requireTab function body — skip past param default `{}`
  const rtStart = BACKGROUND_SRC.indexOf('async function requireTab')
  const rtFirstLine = BACKGROUND_SRC.indexOf('\n', rtStart)
  let depth = 0, rtEnd = rtStart
  for (let i = rtFirstLine; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0 && BACKGROUND_SRC[i] === '}') { rtEnd = i + 1; break }
  }
  const requireTab = BACKGROUND_SRC.substring(rtStart, rtEnd)
  const routeCDP = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf('async function routeCDP'),
    BACKGROUND_SRC.indexOf('async function routeCDP') + 400
  )
  // Both must: try chrome.tabs.get → catch → recover
  assert(requireTab.includes('chrome.tabs.get') && requireTab.includes('catch'),
    'requireTab must try chrome.tabs.get and catch dead tab')
  assert(routeCDP.includes('chrome.tabs.get') && routeCDP.includes('catch'),
    'routeCDP must try chrome.tabs.get and catch dead tab')
})

// ═══════════════════════════════════════════════════════════
// Rule 6: Screenshot — AI-friendly defaults
// Why: kernel screenshot returns PNG (lossless, ~2-4MB for 1920x1080).
// As base64 that's 2.7-5.3M chars — always exceeds AI context token limits.
// tap.screenshot handler must route through captureScreenshot with jpeg+quality.
// Discovered: every screenshot call returned 540K+ chars, unusable.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 6: Screenshot Defaults ──\n')

test('tap.screenshot does not use raw kernel screenshot', () => {
  const ssCase = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf("case 'tap.screenshot'"),
    BACKGROUND_SRC.indexOf("case 'tap.screenshot'") + 400
  )
  assert(!ssCase.includes('tap.screenshot()') || ssCase.includes('routeCDP') || ssCase.includes('captureScreenshot'),
    'tap.screenshot must not call raw kernel.screenshot() — must route through CDP with format/quality')
})

test('tap.screenshot defaults to jpeg format', () => {
  const ssCase = BACKGROUND_SRC.substring(
    BACKGROUND_SRC.indexOf("case 'tap.screenshot'"),
    BACKGROUND_SRC.indexOf("case 'tap.screenshot'") + 400
  )
  assert(ssCase.includes("'jpeg'"),
    'tap.screenshot must default to jpeg format for AI-friendly size')
})

// ═══════════════════════════════════════════════════════════
// Rule 7: Inspect — type-safe value access
// Why: el.value is not always a string. <input type="number"> returns number,
// <progress> returns number, custom elements can have object values.
// Calling .substring() on a number throws TypeError.
// Discovered: inspect_a11y crashed on X due to non-string el.value.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 7: Inspect Type Safety ──\n')

test('inspect.a11y coerces el.value to String before substring', () => {
  const a11ySection = INSPECT_SRC.substring(
    INSPECT_SRC.indexOf("case \"inspect.a11y\""),
    INSPECT_SRC.indexOf("case \"inspect.dom\"")
  )
  assert(!a11ySection.includes('el.value?.substring'),
    'must not call .substring() directly on el.value — use String(el.value) first')
  assert(a11ySection.includes('String(el.value)'),
    'must coerce el.value via String() before calling .substring()')
})

test('inspect.element coerces el.value to String before substring', () => {
  const elemSection = INSPECT_SRC.substring(
    INSPECT_SRC.indexOf("case \"inspect.element\""),
    INSPECT_SRC.indexOf("case \"inspect.a11y\"")
  )
  assert(!elemSection.includes('el.value?.substring'),
    'must not call .substring() directly on el.value — use String(el.value) first')
  assert(elemSection.includes('String(el.value)'),
    'must coerce el.value via String() before calling .substring()')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
