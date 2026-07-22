/**
 * Constraint: extension runtime contract
 * Classification: safety / what -- missing core op = tap runtime crash
 *
 * background.js is a full API gateway implementing 8 core + 17 built-in
 * operations. It must not contain protocol layer remnants (createCore,
 * createBuiltIn, createTap, getTap, handleTapCommand, protocol.js import).
 *
 * Run: node extension/test/protocol.test.mjs
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
// Rule 1: Core Operations Coverage
// Why: handleMethod must have cases for all 8 core operations
// plus a default for unknown methods.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: Core Operations Coverage --\n')

{
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  assert(hmStart !== -1, 'handleMethod must exist')
  const hmBody = BG_SRC.substring(hmStart)
  const caseNames = [...hmBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  const CORE_OPS = ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'cookies', 'capabilities']

  for (const op of CORE_OPS) {
    test(`handleMethod has case for '${op}'`, () => {
      assert(caseNames.includes(op),
        `handleMethod missing case '${op}' -- all 8 core operations must be handled`)
    })
  }

  test('handleMethod has default case for unknown methods', () => {
    assert(hmBody.includes('default:'),
      'handleMethod must have a default case to reject unknown methods')
  })

  test('default case throws Error for unknown method', () => {
    const defaultIdx = hmBody.indexOf('default:')
    const defaultSection = hmBody.substring(defaultIdx, defaultIdx + 200)
    assert(defaultSection.includes('throw') && defaultSection.includes('Unknown'),
      'default case must throw an error for unknown methods')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 2: Built-in Operations in Extension
// Why: Extension is a full runtime (same role as Playwright/macOS).
// handleMethod implements all 17 built-in operations using
// chrome.scripting.executeScript({ func }) for CSP-immune injection.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: Built-in Operations in Extension --\n')

{
  const hmStart = BG_SRC.indexOf('async function handleMethod(')
  const hmBody = BG_SRC.substring(hmStart)
  const caseNames = [...hmBody.matchAll(/case\s+'([^']+)'/g)].map(m => m[1])

  const BUILTIN_OPS = [
    'click', 'type', 'fill', 'hover', 'scroll', 'pressKey', 'select',
    'upload', 'dialog', 'fetch', 'find', 'download',
    'waitFor', 'waitForNetwork', 'ssrState', 'copyAll'
  ]

  test('built-in operation cases exist in handleMethod switch', () => {
    const missing = BUILTIN_OPS.filter(n => !caseNames.includes(n))
    assert.equal(missing.length, 0,
      `missing built-in cases: ${missing.join(', ')} -- extension must handle all 17 built-in operations`)
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 3: No Protocol Layer Remnants
// Why: background.js was simplified from a protocol-delegating bridge
// to a direct API gateway. Old abstractions must not linger.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 3: No Protocol Layer Remnants --\n')

test('no createCore reference', () => {
  assert(!BG_SRC.includes('createCore'),
    'createCore is a protocol abstraction -- background.js implements core directly')
})

test('no createBuiltIn reference', () => {
  assert(!BG_SRC.includes('createBuiltIn'),
    'createBuiltIn belongs in Deno, not extension')
})

test('no createTap reference', () => {
  assert(!BG_SRC.includes('createTap'),
    'createTap is a protocol factory -- background.js is a flat API gateway')
})

test('no getTap reference', () => {
  assert(!BG_SRC.includes('getTap'),
    'getTap was removed when protocol delegation was simplified')
})

test('no handleTapCommand reference', () => {
  assert(!BG_SRC.includes('handleTapCommand'),
    'handleTapCommand was replaced by handleMethod')
})

test('no protocol.js import', () => {
  assert(!BG_SRC.includes("protocol.js") && !BG_SRC.includes("protocol/protocol"),
    'protocol.js no longer exists -- background.js implements operations directly')
})

// ═══════════════════════════════════════════════════════════
// Rule 4: Capabilities Declaration
// Why: capabilities case must exist and declare the runtime
// identity and supported operations, enabling negotiation.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 4: Capabilities Declaration --\n')

{
  const capStart = BG_SRC.indexOf("case 'capabilities':")
  assert(capStart !== -1, 'capabilities case must exist')
  const capBody = BG_SRC.substring(capStart, capStart + 400)

  test('capabilities declares runtime as extension', () => {
    assert(capBody.includes("'extension'"),
      "capabilities must declare runtime: 'extension'")
  })

  test('capabilities lists core operations in supports array', () => {
    const CORE_OPS = ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot']
    for (const op of CORE_OPS) {
      assert(capBody.includes(`'${op}'`),
        `capabilities supports array must include '${op}'`)
    }
  })

  test('capabilities returns an object (not a function call)', () => {
    assert(capBody.includes('return {'),
      'capabilities must return a plain object with runtime info')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 5: Eval-based Inspect Tools NOT in Extension
// Why: eval-based inspect tools (a11y, dom, element, globals, etc.)
// live in Deno src/inspect.ts, not in the extension.
// Exception: inspect.page, inspect.network* need Chrome APIs (tabs.get, CDP Network).
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 5: Eval-based Inspect Tools NOT in Extension --\n')

{
  // These must stay in Deno — they only need eval, not Chrome APIs
  const DENO_ONLY_INSPECT = [
    'inspect.element', 'inspect.a11y', 'inspect.dom',
    'inspect.globals', 'inspect.download', 'inspect.apiLog', 'inspect.toasts',
  ]

  test('eval-based inspect tools not in background.js', () => {
    const found = DENO_ONLY_INSPECT.filter(t => BG_SRC.includes(`case '${t}':`))
    assert.equal(found.length, 0,
      `found eval-based inspect tools in extension: ${found.join(', ')} -- these must live in Deno inspect.ts`)
  })

  // These correctly live in extension — they need Chrome APIs
  test('Chrome-API inspect tools are in extension', () => {
    const EXTENSION_INSPECT = ['inspect.page', 'inspect.networkStart', 'inspect.networkDump', 'inspect.networkStop']
    const found = EXTENSION_INSPECT.filter(t => BG_SRC.includes(`case '${t}':`))
    assert.equal(found.length, EXTENSION_INSPECT.length,
      `extension must implement Chrome-API inspect tools: ${EXTENSION_INSPECT.join(', ')}`)
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 6: Layer Isolation
// Why: background.js must not import from other modules or
// reference executor/forge logic. It uses chrome.runtime.onMessage
// for internal extension communication.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 6: Layer Isolation --\n')

{
  // Carve-out (2026-07-22): the ONE allowed static import is the shared
  // resolver ./tap-deep.js. MV3 module-SW forbids runtime import()
  // (w3c/ServiceWorker#1356) — the previous lazy `await import('./tap-deep.js')`
  // threw "import() is disallowed on ServiceWorkerGlobalScope" on every
  // resolver-needing op (op:input dead in the field). Single-source-of-truth
  // for the resolver (2026-07-21 extraction) therefore REQUIRES this static
  // import; strip exactly that line before the self-containment assertions.
  const ALLOWED_IMPORTS = [
    /^import\s*\{\s*TAP_DEEP_INSTALL\s*\}\s*from\s*'\.\/tap-deep\.js'.*$/m,
    /^import\s*\{\s*PDFDocument\s*\}\s*from\s*'\.\/lib\/pdf-lib\.esm\.js'.*$/m,
  ]
  const stripped = ALLOWED_IMPORTS.reduce((s, re) => s.replace(re, ''), BG_SRC)
    .replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

  test('no executor references (comments stripped)', () => {
    assert(!stripped.toLowerCase().includes('executor'),
      'background.js must not reference executor')
  })

  test('no forge references (comments stripped)', () => {
    assert(!stripped.toLowerCase().includes('forge'),
      'background.js must not reference forge')
  })

  test('no import statements', () => {
    assert(!stripped.includes('import '),
      'background.js must not import from other modules -- it is self-contained')
  })

  test('uses chrome.runtime.onMessage for internal messaging', () => {
    assert(BG_SRC.includes('chrome.runtime.onMessage'),
      'must use chrome.runtime.onMessage for extension internal communication')
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 7: Wire Name Format
// Why: no legacy Tap.*/Bridge.* prefixes in case statements or
// message routing.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 7: Wire Name Format --\n')

test('no legacy Tap.* prefix in any case statement', () => {
  const tapCases = BG_SRC.match(/case\s+'Tap\./g) || []
  assert.equal(tapCases.length, 0,
    `found ${tapCases.length} legacy Tap.* case statements -- use bare names`)
})

test('no legacy Bridge.* prefix in any case statement', () => {
  const bridgeCases = BG_SRC.match(/case\s+'Bridge\./g) || []
  assert.equal(bridgeCases.length, 0,
    `found ${bridgeCases.length} legacy Bridge.* case statements -- use bare names`)
})

test('WebSocket message handler strips tap. prefix for compatibility', () => {
  const wsSection = BG_SRC.substring(BG_SRC.indexOf('ws.onmessage') || 0)
  // Accept either form of prefix-strip: a regex literal (/^tap\./, the
  // current implementation — strictly better because it anchors to the
  // start of the string) or a string literal ('tap.' / "tap."). Both
  // satisfy the protocol contract; only the absence of any tap. strip
  // is a regression.
  const hasRegex = /\.replace\(\s*\/\^tap\\\.\//.test(wsSection)
  const hasStringLiteral = wsSection.includes('replace') &&
    (wsSection.includes("'tap.'") || wsSection.includes('"tap."'))
  assert(hasRegex || hasStringLiteral,
    'WebSocket handler must strip tap. prefix from incoming method names for backward compatibility')
})

// ═══════════════════════════════════════════════════════════
// Rule 8: tap-protocol fields must not leak into RequestInit
// Why: F5 (2026-05-04) — case 'fetch' destructures params then
// Object.assign(init, rest). Tap protocol fields (`credentials`,
// `save`) are NOT fetch RequestInit values; if they propagate
// through `...rest` they corrupt the fetch init dict. Chrome
// rejects `credentials: 'page-session'` with TypeError on the
// invalid enum, and the op fails before the request goes out.
// Regression form: removing the destructure exclusion re-introduces
// the bug. Static guard locks the contract.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 8: case fetch — tap-protocol fields stripped from RequestInit --\n')

{
  const fetchCaseStart = BG_SRC.indexOf("case 'fetch'")
  assert(fetchCaseStart !== -1, "case 'fetch' must exist in handleMethod")
  const after = BG_SRC.substring(fetchCaseStart + 12)
  const nextCase = after.search(/\n\s+case\s+'/)
  const fetchCaseBody = nextCase === -1 ? after : after.substring(0, nextCase)

  test("destructures `credentials` to keep it out of fetch RequestInit", () => {
    const stripped = /credentials\s*[,:}]/.test(fetchCaseBody)
    assert(stripped,
      "case 'fetch' must destructure `credentials` (tap-protocol field, not a RequestInit value — Chrome throws TypeError on `credentials: 'page-session'`)")
  })

  test("destructures `save` to keep it out of fetch RequestInit", () => {
    const stripped = /\bsave\s*[,:}]/.test(fetchCaseBody)
    assert(stripped,
      "case 'fetch' must destructure `save` (tap-protocol scope-binding field, not a RequestInit value)")
  })

  test("Object.assign(init, rest) is preceded by destructuring that excludes tap-protocol fields", () => {
    const assignIdx = fetchCaseBody.indexOf('Object.assign(init')
    assert(assignIdx !== -1, "case 'fetch' must use Object.assign(init, rest) for forward-compat fetch options")
    const beforeAssign = fetchCaseBody.substring(0, assignIdx)
    assert(/credentials\s*[,:}]/.test(beforeAssign),
      "credentials must be destructured BEFORE Object.assign(init, rest)")
    assert(/\bsave\s*[,:}]/.test(beforeAssign),
      "save must be destructured BEFORE Object.assign(init, rest)")
  })
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
