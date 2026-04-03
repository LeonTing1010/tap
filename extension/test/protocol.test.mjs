/**
 * Constraint: Tap protocol contract (POSIX-inspired core + built-in)
 * Classification: safety / what — missing method = tap runtime crash
 *
 * Why: protocol.js is the only interface between .tap.js and the browser.
 * If a method is missing or misnamed, taps fail silently.
 *
 * Architecture: 8 core primitives + 17 built-in operations = 25 total
 *
 * Run: node extension/test/protocol.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

// Core: irreducible primitives every runtime must implement
const CORE_METHODS = ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'tap', 'capabilities']

// Built-in: named operations built on core, runtime may override
const BUILTIN_METHODS = ['click', 'type', 'fill', 'hover', 'scroll', 'pressKey', 'select', 'upload', 'dialog',
  'fetch', 'find', 'cookies', 'download', 'waitFor', 'waitForNetwork', 'ssrState', 'storage']

const ALL_METHODS = [...CORE_METHODS, ...BUILTIN_METHODS]

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

console.log('\nprotocol constraints (POSIX core + built-in)\n')

const src = readFileSync(new URL('../protocol/protocol.js', import.meta.url), 'utf-8')

test('protocol.js exists and is non-empty', () => {
  assert(src.length > 0)
})

test('exports createTap function', () => {
  assert(src.includes('export function createTap'))
})

// --- Architecture constraints ---

console.log('\n  core architecture\n')

test('createCore function exists (runtime-specific layer)', () => {
  assert(src.includes('function createCore('), 'must have createCore for runtime-specific primitives')
})

test('createBuiltIn function exists (built on core)', () => {
  assert(src.includes('function createBuiltIn(core'), 'must have createBuiltIn that takes core as argument')
})

test('built-in receives core as dependency (dependency inversion)', () => {
  assert(src.includes('createBuiltIn(core)'), 'createTap must pass core to createBuiltIn')
})

// --- Core primitives ---

console.log('\n  core primitives (8)\n')

for (const method of CORE_METHODS) {
  test(`core.${method} is defined`, () => {
    const patterns = [`async ${method}(`, `${method}(`]
    const coreSection = src.substring(src.indexOf('function createCore'), src.indexOf('function createBuiltIn'))
    const found = patterns.some(p => coreSection.includes(p))
    assert(found, `core.${method} not found in createCore`)
  })
}

// --- Built-in operations ---

console.log('\n  built-in operations (16)\n')

for (const method of BUILTIN_METHODS) {
  test(`builtIn.${method} is defined`, () => {
    const patterns = [`async ${method}(`, `${method}(`]
    const builtInSection = src.substring(src.indexOf('function createBuiltIn'), src.indexOf('export function createTap'))
    const found = patterns.some(p => builtInSection.includes(p))
    assert(found, `builtIn.${method} not found in createBuiltIn`)
  })
}

// --- Public API (flat merge) ---

console.log('\n  public API (flat merge)\n')

for (const method of ALL_METHODS) {
  test(`tap.${method} is exposed`, () => {
    const pageSection = src.substring(src.indexOf('const tap = {'), src.indexOf('return tap'))
    assert(pageSection.includes(`${method}:`), `tap.${method} not exposed in createTap`)
  })
}

// --- Structural constraints ---

console.log('\n  structural constraints\n')

test('createTap returns tap object', () => {
  const apiSection = src.substring(src.indexOf('export function createTap'))
  assert(apiSection.includes('return tap'))
})

test('built-in uses core.eval (not chrome.scripting directly)', () => {
  const builtInSection = src.substring(src.indexOf('function createBuiltIn'), src.indexOf('export function createTap'))
  assert(builtInSection.includes('core.eval'), 'built-in should call core.eval')
  assert(!builtInSection.includes('chrome.scripting'), 'built-in must NOT use chrome.scripting directly — use core.eval')
})

test('built-in uses core.pointer (not chrome.debugger directly for mouse)', () => {
  const builtInSection = src.substring(src.indexOf('function createBuiltIn'), src.indexOf('export function createTap'))
  assert(builtInSection.includes('core.pointer'), 'built-in should call core.pointer for mouse operations')
})

test('built-in uses core.keyboard (not chrome.debugger directly for keys)', () => {
  const builtInSection = src.substring(src.indexOf('function createBuiltIn'), src.indexOf('export function createTap'))
  assert(builtInSection.includes('core.keyboard'), 'built-in should call core.keyboard for key operations')
})

test('withDebugger helper exists for CDP session management', () => {
  assert(src.includes('withDebugger'), 'must have withDebugger helper')
})

test(`exactly ${ALL_METHODS.length} methods in tap API`, () => {
  const pageSection = src.substring(src.indexOf('const tap = {'), src.indexOf('return tap'))
  // Count property assignments like 'methodName: core.method' or 'methodName: builtIn.method'
  const assignments = pageSection.match(/\w+:\s*(core|builtIn)\.\w+/g) || []
  assert.equal(assignments.length, ALL_METHODS.length,
    `expected ${ALL_METHODS.length} tap methods, found ${assignments.length}: ${assignments.join(', ')}`)
})

// --- Isolation constraints (safety / what — violation = architectural rot) ---

console.log('\n  isolation constraints\n')

test('core does not call or import built-in (no circular dependency)', () => {
  // Why: core is the primitive layer — if it calls built-in, a new runtime can't implement core independently
  const coreSection = src.substring(src.indexOf('function createCore'), src.indexOf('function createBuiltIn'))
  assert(!coreSection.includes('createBuiltIn'), 'core must not call createBuiltIn')
  assert(!coreSection.includes('builtIn.'), 'core must not call built-in methods')
})

test('only createTap and PROTOCOL_VERSION are exported', () => {
  // Why: core and built-in are internal — external code sees merged tap object + version constant
  const exports = src.match(/export\s+(function|const|let|var|class)\s+\w+/g) || []
  assert.equal(exports.length, 2, `expected 2 exports, found ${exports.length}: ${exports.join(', ')}`)
  assert(exports.some(e => e.includes('createTap')), 'must export createTap')
  assert(exports.some(e => e.includes('PROTOCOL_VERSION')), 'must export PROTOCOL_VERSION')
})

// --- Protocol versioning (safety / what — mismatched versions = silent breakage across runtimes) ---

console.log('\n  protocol versioning\n')

test('PROTOCOL_VERSION constant exists and is semver', () => {
  // Why: without a version, runtimes and taps can't negotiate compatibility
  const match = src.match(/export\s+const\s+PROTOCOL_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/)
  assert(match, 'PROTOCOL_VERSION must be exported as semver string (e.g. "1.0.0")')
})

test('capabilities() includes protocol version', () => {
  // Why: runtime self-declaration must include version so callers can check compatibility
  const capImpl = src.indexOf('capabilities() {')
  assert(capImpl !== -1, 'capabilities() not found')
  const capSection = src.substring(capImpl, capImpl + 800)
  assert(capSection.includes('PROTOCOL_VERSION'), 'capabilities() must include PROTOCOL_VERSION')
})

// --- Cross-domain constraint (safety / what-x-what — bridge must delegate to protocol) ---

console.log('\n  cross-domain: bridge → protocol delegation\n')

const bgSrc = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf-8')

test('background.js imports createTap from protocol.js', () => {
  // Why: bridge must use the protocol layer, not reimplement operations
  assert(bgSrc.includes("import { createTap }"), 'background.js must import createTap')
})

test('background.js has getTap factory', () => {
  // Why: factory binds tabId + deps, creating protocol instances for delegation
  assert(bgSrc.includes('function getTap('), 'must have getTap factory')
  assert(bgSrc.includes('createTap('), 'getTap must call createTap')
})

// Delegated handlers: background.js case label → tap method it must call
const DELEGATED_HANDLERS = [
  ['tap.click', 'click'],
  ['tap.type', 'type'],
  ['tap.hover', 'hover'],
  ['tap.scroll', 'scroll'],
  ['tap.pressKey', 'pressKey'],
  ['tap.select', 'select'],
  ['tap.upload', 'upload'],
  ['tap.find', 'find'],
  ['tap.cookies', 'cookies'],
  ['tap.dialog', 'dialog'],
  ['tap.storage', 'storage'],
  ['tap.fetch', 'fetch'],
  ['tap.download', 'download'],
  ['tap.ssrState', 'ssrState'],
  ['tap.capabilities', 'capabilities'],
  ['tap.waitFor', 'waitFor'],
  ['tap.waitForNetwork', 'waitForNetwork'],
]

for (const [caseName, method] of DELEGATED_HANDLERS) {
  test(`${caseName} delegates to tap.${method}`, () => {
    // Why: single source of truth — bridge must not reimplement what protocol provides
    const casePattern = `case '${caseName}':`
    const caseStart = bgSrc.indexOf(casePattern)
    assert(caseStart !== -1, `${caseName} handler not found`)
    const nextCase = bgSrc.indexOf("case '", caseStart + casePattern.length)
    const handlerSection = bgSrc.substring(caseStart, nextCase !== -1 ? nextCase : caseStart + 500)
    assert(handlerSection.includes('getTap('), `${caseName} must use getTap()`)
    assert(handlerSection.includes(`.${method}(`), `${caseName} must call .${method}()`)
  })
}

test('no legacy Tap.* prefix in case statements', () => {
  // Why: protocol envelope routes by method name directly, Tap. prefix is dead code
  const tapCases = bgSrc.match(/case\s+'Tap\./g) || []
  assert.equal(tapCases.length, 0, `found ${tapCases.length} legacy Tap.* case statements — remove prefix`)
})

test('handleMessage does not route by Tap.* or Bridge.* prefix', () => {
  // Why: all bridge communication uses protocol envelope now, prefix routing is legacy
  const handleMsgSection = bgSrc.substring(bgSrc.indexOf('async function handleMessage('), bgSrc.indexOf('async function handleMessage(') + 800)
  assert(!handleMsgSection.includes("startsWith('Tap.')"), 'handleMessage must not route by Tap.* prefix')
  assert(!handleMsgSection.includes("startsWith('Bridge.')"), 'handleMessage must not route by Bridge.* prefix')
})

test('WebSocket bridge routes through handleMessage', () => {
  // Why: all Rust→Extension communication must go through the unified message handler
  const onMessageIdx = bgSrc.indexOf('.onmessage')
  assert(onMessageIdx !== -1, 'WebSocket onmessage handler must exist')
  const onCloseIdx = bgSrc.indexOf('.onclose', onMessageIdx)
  const wsHandler = bgSrc.substring(onMessageIdx, onCloseIdx !== -1 ? onCloseIdx : onMessageIdx + 500)
  assert(wsHandler.includes('handleMessage'), 'WebSocket must route through handleMessage')
})

// --- Capability constraint (quality / what — capabilities() must be accurate) ---

console.log('\n  capability accuracy\n')

test('capabilities() core list matches CORE_METHODS', () => {
  // Why: capabilities() is the runtime's self-declaration — if stale, scripts can't negotiate
  // Find the actual implementation (skip JSDoc), look for 'capabilities() {' pattern
  const capImpl = src.indexOf('capabilities() {')
  assert(capImpl !== -1, 'capabilities() implementation not found')
  const capSection = src.substring(capImpl, capImpl + 600)
  for (const m of CORE_METHODS) {
    assert(capSection.includes(`'${m}'`), `capabilities() missing core method '${m}'`)
  }
})

test('capabilities() builtIn list matches BUILTIN_METHODS', () => {
  // Why: same as above — builtIn declaration must match actual built-in
  const capImpl = src.indexOf('capabilities() {')
  const capSection = src.substring(capImpl, capImpl + 600)
  for (const m of BUILTIN_METHODS) {
    assert(capSection.includes(`'${m}'`), `capabilities() missing builtIn method '${m}'`)
  }
})

// --- Layer isolation constraints (safety / what — violations = architectural rot) ---

console.log('\n  layer isolation\n')

test('background.js does not import core internals (createCore, createBuiltIn)', () => {
  // Why: bridge layer must only depend on the public protocol interface (createTap)
  assert(!bgSrc.includes('createCore'), 'bridge must not import createCore — use createTap')
  assert(!bgSrc.includes('createBuiltIn'), 'bridge must not import createBuiltIn — use createTap')
})

test('background.js delegated handlers do not use chrome.scripting.executeScript', () => {
  // Why: delegated operations must go through protocol layer, not reimplement with raw chrome APIs
  for (const [caseName] of DELEGATED_HANDLERS) {
    const caseStart = bgSrc.indexOf(`case '${caseName}':`)
    if (caseStart === -1) continue
    const nextCase = bgSrc.indexOf("case '", caseStart + caseName.length + 10)
    const section = bgSrc.substring(caseStart, nextCase !== -1 ? nextCase : caseStart + 500)
    assert(!section.includes('chrome.scripting.executeScript'),
      `${caseName} handler uses chrome.scripting directly — must delegate to protocol`)
  }
})

test('protocol.js does not import from background.js (no upward dependency)', () => {
  // Why: protocol is the lower layer — it must not depend on the bridge layer above it
  assert(!src.includes("from '../background"), 'protocol must not import from background.js')
  assert(!src.includes("from './background"), 'protocol must not import from background.js')
})

test('eval-based inspect tools migrated to Deno (not in background.js)', () => {
  // Why: inspect.page/element/a11y/dom/globals/download/apiLog/toasts are pure tap.eval() —
  // they must NOT be in background.js. They live in Deno src/inspect.ts.
  const MIGRATED = ['inspect.page', 'inspect.element', 'inspect.a11y', 'inspect.dom',
    'inspect.globals', 'inspect.download', 'inspect.apiLog', 'inspect.toasts']
  for (const tool of MIGRATED) {
    assert(!bgSrc.includes(`case '${tool}':`),
      `${tool} must not be in background.js — migrated to Deno inspect.ts`)
  }
})

test('Deno mcp.ts tool names all use category.method format', () => {
  // Why: unified naming convention — every tool must have a dot separator
  const mcpSrc = readFileSync(new URL('../../src/mcp.ts', import.meta.url), 'utf-8')
  // Extract only from buildToolsSchema() function (not serverInfo or other metadata)
  const schemaSection = mcpSrc.substring(mcpSrc.indexOf('function buildToolsSchema'))
  const toolNames = [...schemaSection.matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1])
  assert(toolNames.length >= 20, `expected 20+ tools, got ${toolNames.length}`)
  for (const name of toolNames) {
    assert(name.includes('.'), `MCP tool "${name}" missing category.method dot — expected format like "tap.click"`)
  }
})

// ── Daemon Architecture Constraints ──

test('Extension reconnect prevents cascade via identity check', () => {
  // Why: when daemon replaces old connection, the old WebSocket's onclose fires.
  // Without identity check (bridgeSocket === ws), each close triggers a new connect,
  // which triggers another close, creating an infinite reconnect cascade.
  const bgSrc = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf-8')
  const connectFn = bgSrc.substring(bgSrc.indexOf('function connectBridge()'))
  assert(connectFn.includes('bridgeSocket === ws'),
    'onclose must check bridgeSocket === ws to prevent reconnect cascade')
})

test('Extension detaches old socket before reconnecting', () => {
  // Why: old socket's onclose/onerror must be nullified before creating new connection,
  // otherwise stale events from the old socket trigger spurious reconnects.
  const bgSrc = readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf-8')
  const connectFn = bgSrc.substring(bgSrc.indexOf('function connectBridge()'))
  assert(connectFn.includes('onclose = null'),
    'connectBridge must null out old socket onclose before reconnecting')
})

test('Deno cli.ts uses wire names directly (no conversion layer)', () => {
  // Why: wire names are identical everywhere — MCP tool name = tap proxy method = extension case.
  // convertToolName was removed; the default relay passes name through unchanged.
  const cliSrc = readFileSync(new URL('../../src/cli.ts', import.meta.url), 'utf-8')
  assert(!cliSrc.includes('convertToolName'), 'convertToolName must not exist — wire names pass through directly')
  // Verify relay sends name as-is
  assert(cliSrc.includes('client.sendTap("tool", name, args'), 'default relay must send tool name unchanged')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
