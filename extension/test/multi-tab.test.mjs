/**
 * Constraint: multi-tab routing invariants
 * Classification: safety / what -- wrong tab = data from wrong site, debugger on wrong tab
 *
 * background.js routes commands via explicit tabId parameter, falling back
 * to activeTabId only when no tabId is specified. Debugger state is per-tab.
 *
 * Run: node extension/test/multi-tab.test.mjs
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
// Rule 1: Tab Routing
// Why: handleMethod must use params.tabId first, fall back to
// activeTabId, and auto-create a tab when neither is available.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: Tab Routing --\n')

{
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
  const preamble = BG_SRC.substring(hmStart, switchStart)

  test('handleMethod uses params.tabId for routing', () => {
    assert(preamble.includes('params.tabId'),
      'handleMethod must extract tabId from params for explicit tab targeting')
  })

  test('handleMethod falls back to activeTabId', () => {
    assert(preamble.includes('activeTabId'),
      'handleMethod must fall back to activeTabId when params.tabId is not provided')
  })

  test('handleMethod auto-creates tab with chrome.tabs.create', () => {
    assert(preamble.includes('chrome.tabs.create'),
      'handleMethod must auto-create a tab when no valid tabId is available')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 2: Debugger Isolation
// Why: debugger sessions must be per-tab to prevent cross-tab
// interference. A single global debuggerTabId would route all
// CDP commands to one tab.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: Debugger Isolation --\n')

test('debuggerSessions is a per-tab Map', () => {
  assert(BG_SRC.includes('const debuggerSessions = new Map()'),
    'debugger state must be a Map for per-tab isolation')
})

test('no global debuggerTabId variable', () => {
  assert(!BG_SRC.match(/\blet\s+debuggerTabId\b/),
    'must not have a global debuggerTabId -- use per-tab Map instead')
  assert(!BG_SRC.match(/\bvar\s+debuggerTabId\b/),
    'must not have a global debuggerTabId -- use per-tab Map instead')
})

test('withDebugger accepts tabId parameter', () => {
  assert(BG_SRC.includes('async function withDebugger(tabId'),
    'withDebugger must accept tabId as first parameter for per-tab operation')
})

test('cdpClick does not use activeTabId', () => {
  const cdpClickStart = BG_SRC.indexOf('async function cdpClick(')
  const cdpClickBody = BG_SRC.substring(cdpClickStart, cdpClickStart + 400)
  assert(!cdpClickBody.includes('activeTabId'),
    'cdpClick must use its tabId parameter, not activeTabId -- prevents cross-tab clicks')
})

test('cdpClick accepts tabId parameter', () => {
  const cdpClickSig = BG_SRC.substring(
    BG_SRC.indexOf('async function cdpClick('),
    BG_SRC.indexOf('async function cdpClick(') + 60
  )
  assert(cdpClickSig.includes('tabId'),
    'cdpClick must accept tabId as a parameter')
})

test('withDebugger passes tabId to chrome.debugger.attach', () => {
  const wdStart = BG_SRC.indexOf('async function withDebugger(')
  const wdBody = BG_SRC.substring(wdStart, wdStart + 300)
  assert(wdBody.includes('chrome.debugger.attach({ tabId }') ||
    wdBody.includes('chrome.debugger.attach({tabId}'),
    'withDebugger must pass tabId to chrome.debugger.attach')
})

// ═══════════════════════════════════════════════════════════
// Rule 3: Tab Cleanup
// Why: when tabs are closed, their debugger sessions and state
// must be cleaned up to prevent stale references and leaks.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 3: Tab Cleanup --\n')

{
  const onRemovedStart = BG_SRC.indexOf('chrome.tabs.onRemoved.addListener')
  assert(onRemovedStart !== -1, 'must have tabs.onRemoved listener')
  const listenerBody = BG_SRC.substring(onRemovedStart, onRemovedStart + 400)

  test('tabs.onRemoved cleans debuggerSessions.delete', () => {
    assert(listenerBody.includes('debuggerSessions.delete'),
      'must delete debugger session for closed tab')
  })

  test('tabs.onRemoved clears activeTabId when closed tab was active', () => {
    assert(listenerBody.includes('activeTabId = null'),
      'must clear activeTabId when the active tab is closed to prevent stale routing')
  })

  test('tabs.onRemoved clears detach timer for closed tab', () => {
    assert(listenerBody.includes('clearTimeout'),
      'must clear pending detach timer for closed tab')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 4: activeTabId Fallback
// Why: activeTabId is a backward-compatible default. handleMethod
// must NOT set activeTabId (prevents pollution across sessions).
// Only explicit tab management should set it.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: activeTabId Fallback --\n')

test('let activeTabId exists as fallback', () => {
  assert(BG_SRC.includes('let activeTabId'),
    'must keep activeTabId as default fallback variable')
})

test('handleMethod does NOT set activeTabId', () => {
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const hmEnd = BG_SRC.indexOf('\n}', BG_SRC.indexOf('switch (method)', hmStart))
  // Find the full handleMethod function by brace counting
  const bodyStart = BG_SRC.indexOf('{', hmStart)
  let depth = 0, end = bodyStart
  for (let i = bodyStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    if (BG_SRC[i] === '}') depth--
    if (depth === 0) { end = i + 1; break }
  }
  const hmBody = BG_SRC.substring(hmStart, end)

  // Check for activeTabId assignments (exclude reads and null checks)
  const lines = hmBody.split('\n')
  const assignments = lines.filter(line => {
    const t = line.trim()
    return t.includes('activeTabId =') &&
      !t.startsWith('//') &&
      !t.includes('= null') &&
      !t.includes('let ') &&
      !t.includes('|| activeTabId') &&
      !t.includes('? activeTabId')
  })
  assert.equal(assignments.length, 0,
    `handleMethod must not set activeTabId (found ${assignments.length} assignments: ${assignments.map(l => l.trim()).join('; ')}) -- prevents cross-session pollution`)
})

test('activeTabId is initialized to null', () => {
  assert(BG_SRC.includes('let activeTabId = null'),
    'activeTabId must be initialized to null')
})

test('handleMethod reads activeTabId as fallback only', () => {
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
  const preamble = BG_SRC.substring(hmStart, switchStart)
  // It should read activeTabId but not write to it
  assert(preamble.includes('activeTabId'),
    'handleMethod must read activeTabId as fallback')
  // Verify the pattern: params.tabId first, then activeTabId
  const tabIdIdx = preamble.indexOf('params.tabId')
  const activeIdx = preamble.indexOf('activeTabId')
  assert(tabIdIdx < activeIdx,
    'params.tabId must be checked before activeTabId (explicit overrides default)')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
