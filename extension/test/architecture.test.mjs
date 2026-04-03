/**
 * Constraint: extension architecture invariants
 * Classification: safety / what — violations cause silent click failures, debugger conflicts
 *
 * Rules discovered via production debugging:
 *   1. Single debugger: protocol.js must NOT own debugger state; uses DI from background.js
 *   2. Click safety: all CDP clicks must verify elementFromPoint before dispatch
 *   3. Tool layer must not bypass core
 *   4. Unified wire names: MCP tool name = wire method = extension case (no conversion)
 *
 * Run: node extension/test/architecture.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const PAGE_API_SRC = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')
const BACKGROUND_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

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
// Rule 1: Single Debugger Owner (background.js)
// Why: protocol.js (core) owns CDP state via injected deps.
//      If protocol.js has its own chrome.debugger calls or state,
//      two systems fight over debugger attachment → silent failures.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 1: Single Debugger ──\n')

test('protocol.js does not call chrome.debugger directly', () => {
  // Why: if protocol touches debugger, it conflicts with background.js's attach/detach
  assert(!PAGE_API_SRC.includes('chrome.debugger.sendCommand'),
    'protocol.js must not use chrome.debugger — use injected deps instead')
})

test('protocol.js does not track debugger state', () => {
  // Why: debugger state (attached/detached) must be managed by background.js only
  assert(!PAGE_API_SRC.includes('debuggerAttached'),
    'protocol.js must not track debugger state')
})

test('protocol.js click uses injected cdpClick, not own implementation', () => {
  // Why: inlined CDP clicks in protocol would bypass background.js's single debugger
  const pointerSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async pointer('),
    PAGE_API_SRC.indexOf('async keyboard(')
  )
  assert(pointerSection.includes('cdpClick'),
    'core.pointer() must use injected cdpClick')
})

// ═══════════════════════════════════════════════════════════
// Rule 2: Click Safety — elementFromPoint verification
// Why: scrollIntoView({ block: 'center' }) can push elements behind sticky
//      headers. getBoundingClientRect returns "correct" coords but CDP click
//      hits the occluding element. Must verify with elementFromPoint.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 2: Click Safety ──\n')

test('protocol.js click uses elementFromPoint to verify target is reachable', () => {
  // Why: without verification, CDP clicks silently hit sticky headers instead of target
  const clickSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async click('),
    PAGE_API_SRC.indexOf('async type(')
  )
  assert(clickSection.includes('elementFromPoint'),
    'click() must verify coordinates via elementFromPoint before dispatching CDP click')
})

test('background.js click handler delegates to protocol (no inline elementFromPoint)', () => {
  // Why: after protocol unification, click safety lives in protocol.js builtIn.click()
  // background.js must delegate via getTap(), not reimplement element finding
  const clickStart = BACKGROUND_SRC.indexOf("case 'tap.click'")
  const nextCase = BACKGROUND_SRC.indexOf("case '", clickStart + 18)
  const clickSection = BACKGROUND_SRC.substring(clickStart, nextCase)
  assert(clickSection.includes('getTap('),
    'click handler must delegate to protocol via getTap()')
  assert(!clickSection.includes('chrome.scripting.executeScript'),
    'click handler must NOT have inline scripting — delegate to protocol')
})

test('no unconditional scrollIntoView in protocol click', () => {
  // Why: unconditional scroll pushes already-visible elements behind sticky headers
  const clickSection = PAGE_API_SRC.substring(
    PAGE_API_SRC.indexOf('async click('),
    PAGE_API_SRC.indexOf('async type(')
  )
  const scrollCalls = clickSection.match(/scrollIntoView/g) || []
  const viewportChecks = clickSection.match(/innerHeight|innerWidth/g) || []
  if (scrollCalls.length > 0) {
    assert(viewportChecks.length > 0,
      'scrollIntoView found without viewport boundary check — must only scroll when element is outside viewport')
  }
})

// ═══════════════════════════════════════════════════════════
// Rule 3: Tool Layer Must Not Bypass Core
// Why: handleTapCommand is the tool dispatch layer. It must delegate to
//      core (tap.eval, tap.nav, etc.) — never call routeCDP or
//      chrome.scripting/chrome.debugger directly. Bypassing the core
//      breaks runtime portability and creates invisible coupling.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 3: Tool Layer Must Not Bypass Core ──\n')

{
  // Extract handleTapCommand body
  const start = BACKGROUND_SRC.indexOf('async function handleTapCommand(')
  const bodyStart = BACKGROUND_SRC.indexOf('{', start)
  // Find matching closing brace by counting braces
  let depth = 0, end = bodyStart
  for (let i = bodyStart; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0) { end = i + 1; break }
  }
  const cmdBody = BACKGROUND_SRC.substring(bodyStart, end)

  test('handleTapCommand does not call routeCDP directly', () => {
    // Why: tool layer must go through core (getTap), not bypass to CDP
    assert(!cmdBody.includes('routeCDP('),
      'handleTapCommand calls routeCDP() — must use getTap() core methods instead')
  })

  test('handleTapCommand does not use chrome.scripting directly', () => {
    // Why: chrome.scripting belongs to core; tool layer uses tap.eval()
    assert(!cmdBody.includes('chrome.scripting.'),
      'handleTapCommand uses chrome.scripting — must delegate to core via getTap()')
  })

  test('handleTapCommand does not use chrome.debugger directly', () => {
    // Why: chrome.debugger belongs to core; tool layer uses tap.pointer/keyboard
    assert(!cmdBody.includes('chrome.debugger.'),
      'handleTapCommand uses chrome.debugger — must delegate to core via getTap()')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 4: Unified Wire Names
// Why: MCP tool name = wire method = extension case. No conversion layer.
//      Every case in handleTapCommand must use dot notation (tap.*, inspect.*, tab.*, intercept.*).
//      Bare names like 'click' or underscore names like 'tab_list' are forbidden.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 4: Unified Wire Names ──\n')

{
  const start = BACKGROUND_SRC.indexOf('async function handleTapCommand(')
  const bodyStart = BACKGROUND_SRC.indexOf('{', start)
  let depth = 0, end = bodyStart
  for (let i = bodyStart; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0) { end = i + 1; break }
  }
  const cmdBody = BACKGROUND_SRC.substring(bodyStart, end)

  // Extract all case strings
  const caseNames = [...cmdBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  test('all handleTapCommand cases use dot notation', () => {
    const bareCases = caseNames.filter(n => !n.includes('.'))
    assert(bareCases.length === 0,
      `found bare case names without dot notation: ${bareCases.join(', ')} — must use prefix.action format`)
  })

  test('no underscore-separated case names (old naming)', () => {
    const underscoreCases = caseNames.filter(n => n.includes('_') && !n.includes('.'))
    assert(underscoreCases.length === 0,
      `found underscore case names: ${underscoreCases.join(', ')} — must use dot notation`)
  })

  test('extension has no executor import (Deno is the only executor)', () => {
    assert(!BACKGROUND_SRC.includes("from './protocol/executor.js'"),
      'background.js must not import executor.js — Deno executor is the single tap runner')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 5: Every Promise Must Have a Deadline
// Why: A Promise that waits for an event (load, MutationObserver,
//      PerformanceObserver) without a setTimeout safety net can
//      hang forever if the event never fires. This caused a systemic
//      60s timeout bug in kernel.nav() — idle callback had no deadline,
//      affecting all sites (xiaohongshu, wechat, jimeng).
//      Fix: kernel.nav() no longer waits for idle. Constraint ensures
//      no new unbounded Promises are introduced.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 5: Every Promise Must Have a Deadline ──\n')

test('every new Promise in protocol.js contains a setTimeout', () => {
  // Find all new Promise(...) blocks and verify each has a setTimeout
  const promises = []
  const needle = 'new Promise'
  let idx = 0
  while ((idx = PAGE_API_SRC.indexOf(needle, idx)) !== -1) {
    // Find the opening paren of Promise(
    const parenStart = PAGE_API_SRC.indexOf('(', idx + needle.length)
    // Count parens to find matching close
    let depth = 0, end = parenStart
    for (let i = parenStart; i < PAGE_API_SRC.length; i++) {
      if (PAGE_API_SRC[i] === '(') depth++
      if (PAGE_API_SRC[i] === ')') depth--
      if (depth === 0) { end = i + 1; break }
    }
    const body = PAGE_API_SRC.substring(parenStart, end)
    const line = PAGE_API_SRC.substring(0, idx).split('\n').length
    promises.push({ body, line })
    idx = end
  }

  const unbounded = promises.filter(p => !p.body.includes('setTimeout'))
  assert(unbounded.length === 0,
    `found ${unbounded.length} Promise(s) without setTimeout deadline at line(s): ${unbounded.map(p => p.line).join(', ')} — every Promise must have a timeout safety net`)
})

// ═══════════════════════════════════════════════════════════
// Rule 6: core.wait Is Pure Sleep
// Why: core.wait(ms) is a timer primitive — like POSIX sleep(3).
//      Condition-based waiting (polling) was removed because built-in
//      does it better: waitFor uses MutationObserver (1 RPC, event-driven)
//      vs core.wait(fn) which polled via chrome.scripting (N RPCs).
//      If someone re-adds polling to core.wait, it reintroduces the
//      inefficiency and violates core minimality.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 6: core.wait Is Pure Sleep ──\n')

{
  const waitStart = PAGE_API_SRC.indexOf('async wait(')
  const nextMethod = PAGE_API_SRC.indexOf('async ', waitStart + 11)
  const waitBody = PAGE_API_SRC.substring(waitStart, nextMethod)

  test('kernel.wait does not use chrome.scripting (no polling)', () => {
    assert(!waitBody.includes('chrome.scripting'),
      'kernel.wait must not poll via chrome.scripting — condition waiting belongs in stdlib (waitFor)')
  })

  test('kernel.wait does not contain a while loop', () => {
    assert(!/while\s*\(/.test(waitBody),
      'kernel.wait must not have a polling loop — use stdlib waitFor for conditions')
  })

  test('kernel.wait accepts only ms (no function parameter)', () => {
    // The signature should be wait(ms), not wait(msOrFn) or wait(ms, timeout)
    const sig = waitBody.match(/async wait\(([^)]*)\)/)?.[1] || ''
    assert(!sig.includes('Fn') && !sig.includes('timeout') && !sig.includes(','),
      `kernel.wait signature "${sig}" suggests condition support — must be wait(ms) only`)
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 7: Network Capture Survives Debugger Idle
// Why: scheduleDetach disconnects debugger after idle timeout.
//      If it doesn't check netLog.active, network events stop
//      flowing 2s after Network.enable — making inspect.networkDump
//      always return 0 entries. Discovered during reddit/reply forge.
// ═══════════════════════════════════════════════════════════

console.log('\n  ── Rule 7: Network Capture Lifecycle ──\n')

{
  // Extract scheduleDetach body
  const sdStart = BACKGROUND_SRC.indexOf('function scheduleDetach(')
  const sdBodyStart = BACKGROUND_SRC.indexOf('{', sdStart)
  let depth = 0, sdEnd = sdBodyStart
  for (let i = sdBodyStart; i < BACKGROUND_SRC.length; i++) {
    if (BACKGROUND_SRC[i] === '{') depth++
    if (BACKGROUND_SRC[i] === '}') depth--
    if (depth === 0) { sdEnd = i + 1; break }
  }
  const scheduleDetachBody = BACKGROUND_SRC.substring(sdStart, sdEnd)

  test('scheduleDetach checks netLog.active before detaching', () => {
    // Why: debugger detach kills Network events — capture must block detach
    assert(scheduleDetachBody.includes('netLog') && scheduleDetachBody.includes('active'),
      'scheduleDetach must check netLog.active — otherwise network capture silently stops after 2s')
  })

  // Extract networkStart handler
  const nsCase = BACKGROUND_SRC.indexOf("case 'inspect.networkStart':")
  const nsEnd = BACKGROUND_SRC.indexOf('case ', nsCase + 30)
  const networkStartBody = BACKGROUND_SRC.substring(nsCase, nsEnd)

  test('networkStart sets active = true', () => {
    // Why: active flag gates event capture in onEvent listener
    assert(networkStartBody.includes('active = true') || networkStartBody.includes('.active = true'),
      'networkStart must set netLog.active = true')
  })

  test('networkStart calls Network.enable via CDP', () => {
    assert(networkStartBody.includes('Network.enable'),
      'networkStart must call Network.enable to start capturing')
  })

  // Extract networkDump handler
  const ndCase = BACKGROUND_SRC.indexOf("case 'inspect.networkDump':")
  const ndEnd = BACKGROUND_SRC.indexOf('case ', ndCase + 30)
  const networkDumpBody = BACKGROUND_SRC.substring(ndCase, ndEnd)

  test('networkDump deactivates capture', () => {
    // Why: if capture stays active forever, debugger never detaches (resource leak)
    assert(networkDumpBody.includes('active = false') || networkDumpBody.includes('.active = false'),
      'networkDump must set netLog.active = false to allow eventual debugger detach')
  })

  test('networkDump calls scheduleDetach after deactivation', () => {
    assert(networkDumpBody.includes('scheduleDetach'),
      'networkDump must call scheduleDetach so debugger can be released')
  })

  // Extract onEvent handler
  const onEventStart = BACKGROUND_SRC.indexOf('chrome.debugger.onEvent.addListener')
  const onEventEnd = BACKGROUND_SRC.indexOf('\n})', onEventStart) + 3
  const onEventBody = BACKGROUND_SRC.substring(onEventStart, onEventEnd)

  test('onEvent captures Network.requestWillBeSent', () => {
    assert(onEventBody.includes('Network.requestWillBeSent'),
      'event handler must capture request events')
  })

  test('onEvent captures Network.responseReceived', () => {
    assert(onEventBody.includes('Network.responseReceived'),
      'event handler must capture response status')
  })

  test('onEvent captures Network.loadingFinished for response bodies', () => {
    // Why: without loadingFinished, responseBody is never fetched — bodies param is useless
    assert(onEventBody.includes('Network.loadingFinished'),
      'event handler must handle loadingFinished to fetch response bodies')
  })

  test('onEvent captures postData from requests', () => {
    // Why: POST body is critical for forge API analysis (understanding write endpoints)
    assert(onEventBody.includes('postData'),
      'event handler must capture request postData for API analysis')
  })
}

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
