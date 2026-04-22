/**
 * Constraint: background.js is a full runtime API gateway
 * Classification: safety / what -- violations break runtime correctness
 *
 * background.js implements all 25 operations (8 core + 17 built-in).
 * Built-in uses chrome.scripting.executeScript({ func }) — real function
 * injection, CSP-immune. It must NOT contain executor logic, forge logic,
 * or protocol layer remnants.
 *
 * Run: node extension/test/architecture.test.mjs
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
// Rule 1: Debugger State Management
// Why: CDP debugger is a scarce resource (one per tab). State must be
// tracked per-tab via Map, with scheduled detach to avoid leaks.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: Debugger State Management --\n')

test('debuggerSessions is a Map (per-tab state)', () => {
  assert(BG_SRC.includes('const debuggerSessions = new Map()'),
    'must declare debuggerSessions as a Map for per-tab debugger tracking')
})

test('scheduleDetach uses setTimeout for deferred detach', () => {
  const sdStart = BG_SRC.indexOf('function scheduleDetach(')
  assert(sdStart !== -1, 'scheduleDetach function must exist')
  const sdBody = BG_SRC.substring(sdStart, sdStart + 400)
  assert(sdBody.includes('setTimeout'),
    'scheduleDetach must use setTimeout to defer debugger detach')
})

test('scheduleDetach clears previous timer before scheduling', () => {
  const sdStart = BG_SRC.indexOf('function scheduleDetach(')
  const sdBody = BG_SRC.substring(sdStart, sdStart + 400)
  assert(sdBody.includes('clearTimeout'),
    'scheduleDetach must clearTimeout on previous timer to prevent double detach')
})

test('withDebugger delegates to ensureDebugger and has try/finally lifecycle', () => {
  const wdStart = BG_SRC.indexOf('async function withDebugger(')
  assert(wdStart !== -1, 'withDebugger function must exist')
  const wdBody = BG_SRC.substring(wdStart, wdStart + 400)
  assert(wdBody.includes('ensureDebugger'), 'withDebugger must delegate attach to ensureDebugger')
  assert(wdBody.includes('try'), 'withDebugger must have try block')
  assert(wdBody.includes('finally'), 'withDebugger must have finally block')
  assert(wdBody.includes('scheduleDetach'), 'withDebugger must scheduleDetach in finally')
})

test('tab cleanup removes debugger sessions on tab close', () => {
  const onRemovedStart = BG_SRC.indexOf('chrome.tabs.onRemoved.addListener')
  assert(onRemovedStart !== -1, 'must have tabs.onRemoved listener')
  const listenerBody = BG_SRC.substring(onRemovedStart, onRemovedStart + 300)
  assert(listenerBody.includes('debuggerSessions.delete'),
    'tabs.onRemoved must delete debugger session for closed tab')
})

test('tab cleanup clears detach timer on tab close', () => {
  const onRemovedStart = BG_SRC.indexOf('chrome.tabs.onRemoved.addListener')
  const listenerBody = BG_SRC.substring(onRemovedStart, onRemovedStart + 300)
  assert(listenerBody.includes('clearTimeout'),
    'tabs.onRemoved must clear detach timer to prevent operating on closed tab')
})

// ═══════════════════════════════════════════════════════════
// Rule 2: Wire Name Format
// Why: handleMethod cases use bare operation names (eval, pointer, etc).
// No Tap.*/Bridge.* prefix, no underscores. The simplified gateway
// receives bare names directly.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: Wire Name Format --\n')

{
  // Extract all case names from the handleMethod switch
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  assert(hmStart !== -1, 'handleMethod function must exist')
  const hmBody = BG_SRC.substring(hmStart)
  const caseNames = [...hmBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  test('handleMethod cases use bare names (tab.*/inspect.*/intercept.*/session.* namespaces allowed)', () => {
    const allowedNs = ['tab.', 'inspect.', 'intercept.', 'session.']
    const dotCases = caseNames.filter(n => n.includes('.') && !allowedNs.some(ns => n.startsWith(ns)))
    assert.equal(dotCases.length, 0,
      `found dotted case names: ${dotCases.join(', ')} -- only tab.*/inspect.*/intercept.*/session.* namespaces allowed`)
  })

  test('no Tap.* or Bridge.* prefixed cases', () => {
    const legacyCases = caseNames.filter(n => n.startsWith('Tap.') || n.startsWith('Bridge.'))
    assert.equal(legacyCases.length, 0,
      `found legacy prefixed cases: ${legacyCases.join(', ')} -- must use bare names`)
  })

  test('no underscore-separated case names', () => {
    const underscoreCases = caseNames.filter(n => n.includes('_'))
    assert.equal(underscoreCases.length, 0,
      `found underscore case names: ${underscoreCases.join(', ')} -- must use camelCase bare names`)
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 3: Promise Deadlines
// Why: every new Promise must have a setTimeout or event listener
// to prevent hanging forever. Learned from nav() idle callback bug.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 3: Promise Deadlines --\n')

test('every new Promise in background.js has a setTimeout or event listener', () => {
  const promises = []
  const needle = 'new Promise'
  let idx = 0
  while ((idx = BG_SRC.indexOf(needle, idx)) !== -1) {
    const parenStart = BG_SRC.indexOf('(', idx + needle.length)
    let depth = 0, end = parenStart
    for (let i = parenStart; i < BG_SRC.length; i++) {
      if (BG_SRC[i] === '(') depth++
      if (BG_SRC[i] === ')') depth--
      if (depth === 0) { end = i + 1; break }
    }
    const body = BG_SRC.substring(parenStart, end)
    const line = BG_SRC.substring(0, idx).split('\n').length
    promises.push({ body, line })
    idx = end
  }

  assert(promises.length > 0, 'expected at least one new Promise in background.js')

  const unbounded = promises.filter(p =>
    !p.body.includes('setTimeout') && !p.body.includes('addListener') && !p.body.includes('addEventListener')
  )
  assert.equal(unbounded.length, 0,
    `found ${unbounded.length} Promise(s) without setTimeout or event listener at line(s): ${unbounded.map(p => p.line).join(', ')}`)
})

// ═══════════════════════════════════════════════════════════
// Rule 4: No Executor / No Forge
// Why: background.js is a pure runtime. Executor lives in Deno.
// Forge logic lives in Deno. Extension must not contain either.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: No Executor / No Forge --\n')

{
  // Strip comments before checking for "executor" to avoid false positives
  const stripped = BG_SRC.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

  test('no executor references in code (comments stripped)', () => {
    assert(!stripped.toLowerCase().includes('executor'),
      'background.js must not reference executor -- Deno is the only executor')
  })

  test('no forge references in code (comments stripped)', () => {
    assert(!stripped.toLowerCase().includes('forge'),
      'background.js must not reference forge -- forge pipeline lives in Deno')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 5: Full Operation Coverage (8 core + 17 built-in)
// Why: handleMethod implements ALL 25 operations. Built-in
// uses chrome.scripting.executeScript({ func }) for CSP-immune
// function injection. Extension is a full runtime, same role
// as Playwright/macOS runtimes.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 5: Full Operation Coverage --\n')

{
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const hmBody = BG_SRC.substring(hmStart)
  const caseNames = [...hmBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  const BUILTIN_OPS = [
    'click', 'type', 'fill', 'hover', 'scroll', 'pressKey', 'select',
    'upload', 'dialog', 'fetch', 'find', 'download',
    'waitFor', 'waitForNetwork', 'ssrState', 'copyAll'
  ]

  test('handleMethod handles built-in operations', () => {
    const found = caseNames.filter(n => BUILTIN_OPS.includes(n))
    assert(found.length > 0,
      `handleMethod must handle built-in operations -- extension is a full runtime`)
    // Verify all 17 built-in ops are present (storage/cookies are in core section)
    const missing = BUILTIN_OPS.filter(n => !caseNames.includes(n))
    assert.equal(missing.length, 0,
      `missing built-in operations in handleMethod: ${missing.join(', ')}`)
  })

  test('built-in uses execFunc helper for CSP-immune injection', () => {
    assert(BG_SRC.includes('async function execFunc('),
      'background.js must have execFunc helper for chrome.scripting function injection')
    assert(BG_SRC.includes('chrome.scripting.executeScript'),
      'execFunc must use chrome.scripting.executeScript')
  })

  test('no createBuiltIn function or import', () => {
    assert(!BG_SRC.includes('createBuiltIn'),
      'background.js must not have createBuiltIn -- built-in is implemented directly')
  })

  test('no createTap function or import', () => {
    assert(!BG_SRC.includes('createTap'),
      'background.js must not have createTap -- protocol layer was removed')
  })

  test('no getTap function or import', () => {
    assert(!BG_SRC.includes('getTap'),
      'background.js must not have getTap -- protocol delegation was removed')
  })
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
