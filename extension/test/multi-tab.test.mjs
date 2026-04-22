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
// Why: handleMethod must use params.tabId first, fall back to the
// currently active tab, and support auto-creating a tab for
// tab-creating methods (nav, session.create, tab.new).
// Post-SessionManager refactor (commit 8c32d78) inlines this logic
// in handleMethod's preamble; the invariants are the contract, not
// the function shape.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: Tab Routing --\n')

{
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  assert(hmStart !== -1, 'handleMethod function must exist')
  const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
  assert(switchStart !== -1, 'handleMethod must contain a switch (method) block')
  const preamble = BG_SRC.substring(hmStart, switchStart)

  test('handleMethod uses params.tabId for routing', () => {
    assert(preamble.includes('params.tabId'),
      'handleMethod preamble must extract tabId from params for explicit tab targeting')
  })

  test('handleMethod falls back to the currently active tab', () => {
    const viaActiveId = preamble.includes('activeTabId')
    const viaQuery = /chrome\.tabs\.query\([^)]*active:\s*true/.test(preamble)
    assert(viaActiveId || viaQuery,
      'handleMethod must fall back to the active tab when params.tabId is missing (activeTabId or chrome.tabs.query active:true)')
  })

  test('handleMethod supports auto-creating tabs via chrome.tabs.create', () => {
    // Creation lives in specific case handlers (nav, session.create, tab.new)
    // after the SessionManager refactor, not in a central resolver.
    assert(BG_SRC.includes('chrome.tabs.create'),
      'background.js must call chrome.tabs.create in tab-creating case handlers')
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
  // Slice to the closing `})` of the listener so session cleanup (which lives
  // after debugger/network cleanup) is included.
  const onRemovedEnd = BG_SRC.indexOf('\n})', onRemovedStart)
  const listenerBody = BG_SRC.substring(onRemovedStart, onRemovedEnd === -1 ? onRemovedStart + 1200 : onRemovedEnd + 3)

  test('tabs.onRemoved cleans debuggerSessions.delete', () => {
    assert(listenerBody.includes('debuggerSessions.delete'),
      'must delete debugger session for closed tab')
  })

  test('tabs.onRemoved clears detach timer for closed tab', () => {
    assert(listenerBody.includes('clearTimeout'),
      'must clear pending detach timer for closed tab')
  })

  test('tabs.onRemoved removes any session that owned the closed tab', () => {
    // Post-SessionManager refactor: session rows own tabs; orphans must be
    // cleaned up when the tab dies or the session map rots into dangling refs.
    assert(listenerBody.includes('sessions.delete') || listenerBody.includes('sessions ='),
      'must clean up sessions whose tabId matches the closed tab')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 4: Session Isolation & Daemon Fallback Gate
// Why: multiple MCP sessions share the same daemon. Daemon-originated
// commands must use ONLY their explicit tabId, never silently fall
// back to whatever tab is currently active. Otherwise session A's
// nav leaks onto session B's tab (the "tab stealing" bug).
//
// Post-SessionManager refactor (commit 8c32d78) expresses this with:
//   - a top-level `sessions` Map owning session→tab mappings
//   - handleMethod's preamble gates the active-tab fallback on
//     `!fromDaemon`, so daemon callers never fall back
//   - handleAndReport (daemon poll handler) always sets fromDaemon: true
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: Session Isolation & Daemon Fallback Gate --\n')

test('sessions Map tracks session → tab ownership', () => {
  assert(/const\s+sessions\s*=\s*new\s+Map\(/.test(BG_SRC),
    'must keep a top-level `sessions` Map so each MCP session owns its tab without a global activeTabId')
})

test('handleMethod gates the active-tab fallback on !fromDaemon', () => {
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const switchStart = BG_SRC.indexOf('switch (method)', hmStart)
  const preamble = BG_SRC.substring(hmStart, switchStart)
  // Daemon commands must not invoke chrome.tabs.query active:true without a !fromDaemon guard
  const queryIdx = preamble.search(/chrome\.tabs\.query\([^)]*active:\s*true/)
  assert(queryIdx !== -1, 'handleMethod preamble must query active tab for non-daemon callers')
  const before = preamble.substring(0, queryIdx)
  assert(/!\s*fromDaemon/.test(before),
    'active-tab fallback must be gated on !fromDaemon so daemon commands never silently retarget')
})

test('handleAndReport passes fromDaemon: true', () => {
  const fnStart = BG_SRC.indexOf('async function handleAndReport(')
  assert(fnStart !== -1, 'handleAndReport (daemon poll handler) must exist')
  const fnBody = BG_SRC.substring(fnStart, fnStart + 500)
  assert(fnBody.includes('fromDaemon: true') || fnBody.includes('fromDaemon:true'),
    'handleAndReport must pass fromDaemon: true to handleMethod so daemon commands hit the gated path')
})

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
