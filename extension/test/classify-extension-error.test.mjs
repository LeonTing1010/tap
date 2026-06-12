/**
 * tap-core#65 — classifyExtensionError routes op:eval page exceptions to
 * eval_error, NOT the peer_unreachable default.
 *
 * Why behavioral (extract + run): a grep for "eval_error" would pass a
 * half-impl that put the branch AFTER the `return peer_unreachable` (dead
 * code). This extracts the real function from background.js, injects the
 * WIRE_CODE table it closes over, and runs it against representative inputs.
 *
 * Constraint: a JS exception surfaced by op:eval (method === 'eval') must
 * map to WIRE_CODE.eval_error; the same message under a non-eval method must
 * still fall through to peer_unreachable (the eval carve-out is method-gated,
 * so a stray "TypeError: Failed to fetch" from another op is not swept up).
 *
 * Run: node extension/test/classify-extension-error.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// --- Extract the WIRE_CODE table + classifyExtensionError and build a runnable copy ---
function buildClassifier(src) {
  const wireMatch = src.match(/const WIRE_CODE = (\{[\s\S]*?\n\})/)
  assert(wireMatch, 'background.js must declare const WIRE_CODE = {...}')
  const fnStart = src.indexOf('function classifyExtensionError(')
  assert(fnStart !== -1, 'classifyExtensionError must exist')
  // brace-match the function body
  const bodyStart = src.indexOf('{', fnStart)
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { i++; break } }
  }
  const fnSrc = src.slice(fnStart, i)
  // eslint-disable-next-line no-new-func
  return new Function(`${wireMatch[0]}\n${fnSrc}\nreturn classifyExtensionError`)()
}

const classify = buildClassifier(BG_SRC)
const WIRE = (() => {
  const m = BG_SRC.match(/const WIRE_CODE = (\{[\s\S]*?\n\})/)
  // eslint-disable-next-line no-new-func
  return new Function(`return ${m[1]}`)()
})()

console.log('\n  -- tap-core#65 classifyExtensionError eval routing --\n')

test('op:eval JS exception → eval_error (not peer_unreachable)', () => {
  const code = classify("TypeError: Cannot read properties of undefined (reading 'x')", 'eval')
  assert.equal(code, WIRE.eval_error,
    `eval page exception must map to eval_error (${WIRE.eval_error}); got ${code}`)
  assert.notEqual(code, WIRE.peer_unreachable,
    'eval exception must NOT map to peer_unreachable (that mis-routes to reconnect_extension)')
})

test('same message under a non-eval method stays peer_unreachable (method-gated)', () => {
  const code = classify('TypeError: Failed to fetch', 'nav')
  assert.equal(code, WIRE.peer_unreachable,
    'the eval carve-out must be method-gated, not message-only')
})

test('specific matches still win under method=eval (csp before eval fallback)', () => {
  const code = classify('content security policy blocked', 'eval')
  assert.equal(code, WIRE.csp_violation,
    'a recognizable csp message must classify as csp_violation even under eval')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
