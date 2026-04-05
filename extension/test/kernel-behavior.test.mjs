/**
 * Constraint: core operation behavioral correctness
 * Classification: safety / what -- violations cause silent failures on real sites
 *
 * Architecture tests check structural purity. These constraints verify the
 * implementation patterns that make core primitives behaviorally correct --
 * discovered via real-world failures.
 *
 * Run: node extension/test/kernel-behavior.test.mjs
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

// ═══════════════════════════════════════════════════════════
// Rule 1: CDP Click Event Chain
// Why: React and other frameworks need mousePressed + mouseReleased
// as a pair. Missing either means the click never registers.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: CDP Click Event Chain --\n')

{
  const cdpClickStart = BG_SRC.indexOf('async function cdpClick(')
  assert(cdpClickStart !== -1, 'cdpClick function must exist')
  // Find the end of cdpClick by locating the next top-level function or section
  const cdpClickBody = BG_SRC.substring(cdpClickStart, cdpClickStart + 500)

  test('cdpClick dispatches mousePressed', () => {
    assert(cdpClickBody.includes('mousePressed'),
      'cdpClick must dispatch mousePressed event')
  })

  test('cdpClick dispatches mouseReleased', () => {
    assert(cdpClickBody.includes('mouseReleased'),
      'cdpClick must dispatch mouseReleased event')
  })

  test('mousePressed comes before mouseReleased', () => {
    const pressedIdx = cdpClickBody.indexOf('mousePressed')
    const releasedIdx = cdpClickBody.indexOf('mouseReleased')
    assert(pressedIdx < releasedIdx,
      'mousePressed must come before mouseReleased -- press then release')
  })

  test('cdpClick uses Input.dispatchMouseEvent', () => {
    assert(cdpClickBody.includes('Input.dispatchMouseEvent'),
      'cdpClick must use CDP Input.dispatchMouseEvent for native mouse events')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 2: Keyboard Key Codes
// Why: CDP windowsVirtualKeyCode must match expected values.
// Wrong key codes cause modifier combos to silently fail.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: Keyboard Key Codes --\n')

{
  const keyMapStart = BG_SRC.indexOf('const KEY_MAP')
  assert(keyMapStart !== -1, 'KEY_MAP must exist')
  const keyMapBody = BG_SRC.substring(keyMapStart, keyMapStart + 800)

  test('KEY_MAP has Enter with windowsVirtualKeyCode 13', () => {
    assert(keyMapBody.includes('Enter') && keyMapBody.includes('13'),
      'Enter key must map to windowsVirtualKeyCode 13')
  })

  test('KEY_MAP has Tab with windowsVirtualKeyCode 9', () => {
    assert(keyMapBody.includes('Tab') && keyMapBody.includes(': 9'),
      'Tab key must map to windowsVirtualKeyCode 9')
  })

  test('KEY_MAP has Escape with windowsVirtualKeyCode 27', () => {
    assert(keyMapBody.includes('Escape') && keyMapBody.includes('27'),
      'Escape key must map to windowsVirtualKeyCode 27')
  })

  test('keyboard fallback uses toUpperCase().charCodeAt for virtual codes', () => {
    const kbStart = BG_SRC.indexOf("case 'keyboard':")
    const kbBody = BG_SRC.substring(kbStart, kbStart + 800)
    assert(kbBody.includes('toUpperCase().charCodeAt'),
      'windowsVirtualKeyCode for letter keys must use toUpperCase().charCodeAt(0) -- lowercase codes are ignored by Chrome')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 3: Keyboard Modifier Commands
// Why: CDP keyDown with Meta modifier alone does not execute browser
// shortcuts. Chrome requires `commands: ['selectAll']` for Cmd+A.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 3: Keyboard Modifier Commands --\n')

{
  const kbStart = BG_SRC.indexOf("case 'keyboard':")
  const kbBody = BG_SRC.substring(kbStart, kbStart + 1200)

  test('keyboard builds commands array for modifier combos', () => {
    assert(kbBody.includes('commands'),
      'keyboard case must build commands array for modifier key combos')
  })

  test('keyboard maps Meta+A to selectAll', () => {
    assert(kbBody.includes('selectAll'),
      'Meta+A must map to selectAll command')
  })

  test('keyboard maps Meta+C to copy', () => {
    assert(kbBody.includes('copy'),
      'Meta+C must map to copy command')
  })

  test('keyboard maps Meta+V to paste', () => {
    assert(kbBody.includes('paste'),
      'Meta+V must map to paste command')
  })

  test('type action uses keyDown/keyUp per character', () => {
    // Find the type action section within keyboard case
    assert(kbBody.includes("action === 'type'"),
      'keyboard must handle type action')
    const typeSection = kbBody.substring(kbBody.indexOf("action === 'type'"))
    assert(typeSection.includes('keyDown') && typeSection.includes('keyUp'),
      'type action must dispatch keyDown and keyUp per character')
    assert(typeSection.includes('for'),
      'type action must iterate over characters')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 4: Eval Scope Isolation
// Why: const/let at global scope cannot be redeclared. Block
// wrapping { expr } scopes them so repeated evals work.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: Eval Scope Isolation --\n')

{
  const evalStart = BG_SRC.indexOf("case 'eval':")
  const evalBody = BG_SRC.substring(evalStart, evalStart + 2000)

  test('eval wraps expression in block scope', () => {
    assert(evalBody.includes("'{\\n'") || evalBody.includes("'\\n}'") ||
      evalBody.includes("'{\\n' + params") ||
      (evalBody.includes('{\\n') && evalBody.includes('\\n}')) ||
      evalBody.includes("safeExpr"),
      'eval must wrap expression in block scope { } to prevent const/let redeclaration errors')
    // Verify the actual block wrapping pattern
    assert(evalBody.includes('safeExpr'),
      'eval must compute safeExpr (block-wrapped expression)')
  })

  test('safeExpr adds block scope braces', () => {
    // Find the safeExpr assignment
    const safeExprLine = BG_SRC.substring(BG_SRC.indexOf('safeExpr'), BG_SRC.indexOf('safeExpr') + 100)
    assert(safeExprLine.includes('{') && safeExprLine.includes('}'),
      'safeExpr must wrap expression in { } block scope')
  })

  test('eval uses chrome.scripting.executeScript with MAIN world', () => {
    assert(evalBody.includes('chrome.scripting.executeScript'),
      'eval must use chrome.scripting.executeScript')
    assert(evalBody.includes("'MAIN'"),
      'eval must execute in MAIN world to access page context')
  })

  test('eval has CDP fast path when debugger attached', () => {
    assert(evalBody.includes('debuggerSessions.get'),
      'eval must check if debugger is attached for fast path')
    assert(evalBody.includes('Runtime.evaluate'),
      'eval CDP fast path must use Runtime.evaluate')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 5: Tab Recovery
// Why: when a tab is manually closed, its ID becomes stale.
// resolveTab() validates tab exists and auto-creates if needed.
// handleMethod delegates to resolveTab() for tab resolution.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 5: Tab Recovery --\n')

{
  const rtStart = BG_SRC.indexOf('async function resolveTab(')
  assert(rtStart !== -1, 'resolveTab function must exist')
  const rtEnd = BG_SRC.indexOf('\n}', rtStart + 10)
  const rtBody = BG_SRC.substring(rtStart, rtEnd + 2)

  test('resolveTab validates tab exists via chrome.tabs.get', () => {
    assert(rtBody.includes('chrome.tabs.get'),
      'resolveTab must call chrome.tabs.get to verify tab still exists')
  })

  test('resolveTab catches dead tab errors', () => {
    assert(rtBody.includes('catch'),
      'resolveTab must catch errors from chrome.tabs.get for dead tabs')
  })

  test('resolveTab auto-creates tab when none exists', () => {
    assert(rtBody.includes('chrome.tabs.create'),
      'resolveTab must auto-create a tab when no valid tab is found')
  })

  test('handleMethod delegates to resolveTab', () => {
    const hmStart = BG_SRC.indexOf('async function handleMethod(')
    const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
    const preamble = BG_SRC.substring(hmStart, switchStart)
    assert(preamble.includes('resolveTab'),
      'handleMethod must delegate tab resolution to resolveTab()')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 6: Screenshot Defaults
// Why: PNG screenshots are too large for AI context. Must default
// to jpeg with quality parameter for reasonable size.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 6: Screenshot Defaults --\n')

{
  const ssStart = BG_SRC.indexOf("case 'screenshot':")
  const ssBody = BG_SRC.substring(ssStart, ssStart + 300)

  test('screenshot defaults to jpeg format', () => {
    assert(ssBody.includes("'jpeg'"),
      'screenshot must default to jpeg format for AI-friendly size')
  })

  test('screenshot includes quality parameter', () => {
    assert(ssBody.includes('quality'),
      'screenshot must include quality parameter for size control')
  })

  test('screenshot uses CDP Page.captureScreenshot (targets specific tabId)', () => {
    assert(ssBody.includes('Page.captureScreenshot'),
      'screenshot must use CDP Page.captureScreenshot to target specific tabId (not captureVisibleTab which grabs foreground tab)')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 8: Click Uses JS-First, CDP Fallback
// Why: cdpClick triggers chrome.debugger.attach → visible yellow
// "debugging" bar. JS el.click() via execFunc is invisible to user
// and immune to CSP. CDP only needed when isTrusted is required.
// Classification: quality / what — yellow bar degrades UX
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 8: Click JS-First --\n')

{
  const clickStart = BG_SRC.indexOf("case 'click':")
  const clickEnd = BG_SRC.indexOf("case 'type':")
  const clickBody = BG_SRC.substring(clickStart, clickEnd)

  test('click uses execFunc for JS click (not cdpClick as primary)', () => {
    // Why: execFunc injects real function via chrome.scripting — no debugger needed
    assert(clickBody.includes('el.click()') || clickBody.includes('.click()'),
      'click must use JS el.click() via execFunc as primary path')
  })

  test('click has CDP fallback for isTrusted failures', () => {
    // Why: some sites (Google, payment forms) check event.isTrusted
    assert(clickBody.includes('cdpClick'),
      'click must fall back to cdpClick when JS click fails')
  })

  test('click tries JS before CDP (JS is first path)', () => {
    // Why: JS click = no debugger bar, no user-visible side effects
    const jsClickPos = clickBody.indexOf('.click()')
    const cdpClickPos = clickBody.indexOf('cdpClick')
    assert(jsClickPos < cdpClickPos,
      'JS click must come before CDP click in the execution flow')
  })
}

// ══════════════════════════════════════════════════════���════
// Rule 9: Dialog Uses JS Override, Not CDP
// Why: CDP Page.handleJavaScriptDialog requires debugger attach.
// JS window.confirm/alert/prompt override via execFunc avoids it.
// Classification: quality / what — debugger attach for dialog is overkill
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 9: Dialog JS Override --\n')

{
  const dialogStart = BG_SRC.indexOf("case 'dialog':")
  // Find next case after dialog (not default: — other cases may follow)
  const dialogEnd = BG_SRC.indexOf("\n    case ", dialogStart + 1)
  const dialogBody = BG_SRC.substring(dialogStart, dialogEnd > 0 ? dialogEnd : dialogStart + 500)

  test('dialog uses execFunc (JS override), not CDP', () => {
    // Why: execFunc injects function that overrides window.confirm etc.
    assert(dialogBody.includes('execFunc'),
      'dialog must use execFunc for JS-based dialog handling')
  })

  test('dialog does not use withDebugger or CDP', () => {
    // Why: dialog should not trigger debugger attach
    assert(!dialogBody.includes('withDebugger') && !dialogBody.includes('chrome.debugger'),
      'dialog must not use CDP — JS override is sufficient')
  })

  test('dialog overrides window.confirm/alert/prompt', () => {
    // Why: overriding native dialog functions catches future dialogs
    assert(dialogBody.includes('confirm') || dialogBody.includes('alert'),
      'dialog must override native dialog functions')
  })
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
