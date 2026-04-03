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
// Why: resolveTab() must use params.tabId first, fall back to
// activeTabId, and auto-create a tab when neither is available.
// handleMethod delegates to resolveTab().
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: Tab Routing --\n')

{
  const rtStart = BG_SRC.indexOf('async function resolveTab(')
  assert(rtStart !== -1, 'resolveTab function must exist')
  const rtBody = BG_SRC.substring(rtStart, rtStart + 500)

  test('resolveTab uses params.tabId for routing', () => {
    assert(rtBody.includes('params.tabId'),
      'resolveTab must extract tabId from params for explicit tab targeting')
  })

  test('resolveTab falls back to activeTabId', () => {
    assert(rtBody.includes('activeTabId'),
      'resolveTab must fall back to activeTabId when params.tabId is not provided')
  })

  test('resolveTab auto-creates tab with chrome.tabs.create', () => {
    assert(rtBody.includes('chrome.tabs.create'),
      'resolveTab must auto-create a tab when no valid tabId is available')
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

test('ensureDebugger passes tabId to chrome.debugger.attach', () => {
  const edStart = BG_SRC.indexOf('async function ensureDebugger(')
  assert(edStart !== -1, 'ensureDebugger function must exist')
  const edBody = BG_SRC.substring(edStart, edStart + 500)
  assert(edBody.includes('chrome.debugger.attach({ tabId }') ||
    edBody.includes('chrome.debugger.attach({tabId}'),
    'ensureDebugger must pass tabId to chrome.debugger.attach')
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
// Rule 4: activeTabId Management
// Why: activeTabId is the default tab for commands without explicit tabId.
// It must be set on auto-create and nav (so subsequent calls reuse the tab),
// but explicit tabId in params always takes priority.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: activeTabId Management --\n')

test('let activeTabId exists as fallback', () => {
  assert(BG_SRC.includes('let activeTabId'),
    'must keep activeTabId as default fallback variable')
})

test('resolveTab sets activeTabId on auto-create', () => {
  const rtStart = BG_SRC.indexOf('async function resolveTab(')
  const rtBody = BG_SRC.substring(rtStart, rtStart + 500)
  const autoCreate = rtBody.indexOf('chrome.tabs.create')
  const context = rtBody.substring(autoCreate, autoCreate + 200)
  assert(context.includes('activeTabId = tabId') || context.includes('activeTabId ='),
    'must set activeTabId when auto-creating a tab so subsequent calls reuse it')
})

test('params.tabId takes priority over activeTabId', () => {
  const rtStart = BG_SRC.indexOf('async function resolveTab(')
  const rtBody = BG_SRC.substring(rtStart, rtStart + 500)
  assert(rtBody.includes('params.tabId'),
    'resolveTab must check params.tabId first before falling back to activeTabId')
  const tabIdIdx = rtBody.indexOf('params.tabId')
  const activeIdx = rtBody.indexOf('activeTabId')
  assert(tabIdIdx < activeIdx,
    'params.tabId must be checked before activeTabId (explicit overrides default)')
})

test('activeTabId is initialized to null', () => {
  assert(BG_SRC.includes('let activeTabId = null'),
    'activeTabId must be initialized to null')
})

test('handleMethod delegates tab resolution to resolveTab', () => {
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
  const preamble = BG_SRC.substring(hmStart, switchStart)
  assert(preamble.includes('resolveTab'),
    'handleMethod must delegate tab resolution to resolveTab()')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
