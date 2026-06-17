/**
 * Constraint: CDP input (cdpClick / trusted op:input) survives a debugger
 * session that Chrome reclaimed while the MV3 service worker was idle, or
 * detached on navigation — instead of failing with "Detached while handling
 * command" / "Debugger is not attached".
 * Classification: safety / what — trusted-click silently dies on a stale
 *                                 session (2026-06-15 AGC trusted-click-in-
 *                                 iframe detach repro: nav + ~14s idle wait
 *                                 → Chrome reclaims session → debuggerSessions
 *                                 still says attached:true → sendCommand throws)
 *
 * Why: background.js line ~1798 already documents that "MV3 service workers go
 * idle ... Chrome reclaims the debugger session — even though no detach was
 * explicit and our debuggerSessions Map still says attached:true." For the
 * INLINE network listeners that note worked around it by capturing data
 * synchronously. But cdpClick runs from a USER command (op:input trusted),
 * exactly the at-risk path: ensureDebugger sees the stale attached:true,
 * no-ops, and the Input.dispatchMouseEvent throws. The fix is two-fold:
 *   (1) a chrome.debugger.onDetach listener clears debuggerSessions so an
 *       EXPLICIT detach (nav, DevTools) doesn't leave a stale entry, and
 *   (2) cdpClick recovers from the SILENT reclaim (no onDetach fires) by
 *       catching the not-attached error, clearing the stale entry,
 *       re-attaching (ensureDebugger), and re-dispatching once.
 *
 * ADVERSARIAL framing:
 *   - A half-impl that catches the error and swallows it (returns without
 *     re-dispatching) would make the click a silent no-op — worse than the
 *     throw. Rule 3 asserts the dispatch sequence is reachable twice.
 *   - A half-impl that catches but forgets to clear debuggerSessions would
 *     re-enter ensureDebugger, see the stale attached:true, no-op, and throw
 *     again. Rule 2 asserts the recovery deletes the session before retry.
 *   - A half-impl that only adds onDetach (not the cdpClick retry) would NOT
 *     fix the silent MV3 reclaim (which fires no onDetach). Rule 2/3 cover it.
 *
 * Run: node extension/test/cdp-detach-recovery.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0
let failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`) }
}

// Brace-match the cdpClick function body so assertions are scoped to it.
function cdpClickBody() {
  const start = BG.indexOf('async function cdpClick')
  assert(start !== -1, 'cdpClick function must exist')
  const open = BG.indexOf('{', start)
  let depth = 0, i = open
  for (; i < BG.length; i++) {
    if (BG[i] === '{') depth++
    else if (BG[i] === '}') { depth--; if (depth === 0) break }
  }
  return BG.slice(start, i + 1)
}

console.log('\n  -- Rule 1: onDetach listener clears the stale session --\n')

test('chrome.debugger.onDetach listener registered', () => {
  assert(
    BG.includes('chrome.debugger.onDetach.addListener'),
    'must register chrome.debugger.onDetach.addListener so an explicit/nav ' +
      'detach clears debuggerSessions instead of leaving attached:true stale',
  )
})

test('onDetach handler deletes the detached tab from debuggerSessions', () => {
  const idx = BG.indexOf('chrome.debugger.onDetach.addListener')
  assert(idx !== -1, 'onDetach listener must exist (see Rule 1)')
  const body = BG.slice(idx, idx + 400)
  assert(
    /debuggerSessions\.delete\(/.test(body),
    `onDetach handler must debuggerSessions.delete(...) — body: ${body.slice(0, 160)}`,
  )
})

console.log('\n  -- Rule 2: cdpClick recovers from a reclaimed session --\n')

test('cdpClick catches the not-attached/detached error', () => {
  const body = cdpClickBody()
  assert(/catch/.test(body), 'cdpClick must catch to recover from session reclaim')
  assert(
    /not attached|detached/i.test(body),
    'cdpClick recovery must key on the "not attached"/"detached" error string',
  )
})

test('cdpClick clears stale session AND re-attaches before retry', () => {
  const body = cdpClickBody()
  assert(
    /debuggerSessions\.delete\(/.test(body),
    'cdpClick recovery must clear the stale debuggerSessions entry before retry',
  )
  assert(
    /ensureDebugger/.test(body),
    'cdpClick recovery must re-attach via ensureDebugger before re-dispatching',
  )
})

console.log('\n  -- Rule 3 (adversarial): recovery re-dispatches, not swallow --\n')

test('cdpClick re-dispatches the click sequence on retry', () => {
  const body = cdpClickBody()
  // The press/release dispatch must be reachable twice — either literally
  // duplicated, or factored into a helper invoked twice (e.g. `seq()`).
  const dispatches = (body.match(/dispatchMouseEvent/g) || []).length
  const helperCalls = (body.match(/\bseq\s*\(\s*\)/g) || []).length
  assert(
    dispatches >= 6 || helperCalls >= 2 || (dispatches >= 3 && helperCalls >= 1),
    `cdpClick must re-run the dispatch on retry (not swallow): found ` +
      `${dispatches} dispatchMouseEvent + ${helperCalls} seq() calls`,
  )
})

console.log(`\n  ${passed}/${passed + failed} passed`)
if (failed > 0) { console.log(`\n  \x1b[31m${failed} failed\x1b[0m\n`); process.exit(1) }
console.log('\n  \x1b[32mAll cdp-detach-recovery tests passed\x1b[0m\n')
