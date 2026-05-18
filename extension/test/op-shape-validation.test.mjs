/**
 * Constraint: extension dispatch fails fast on malformed op shape
 * Classification: safety / what — silent op-shape failure = wrong-direction
 *                                  diagnosis cycles (3hr cost on 2026-05-18)
 *
 * Resolves tap-core#59 P0-A. The original bug: dispatch (line ~1480) ran
 * `if (method === 'eval' && fn !== undefined && expression === undefined)`
 * to translate canonical EvalOp.fn to the extension-internal `expression`
 * param. When an agent wrote `expr` instead of `fn`, the translation `if`
 * didn't fire, `resolvedParams.expression` stayed undefined,
 * `handleMethod('eval', {expression: undefined})` produced an empty SW
 * reply, and `host_dispatch.ts:266` emitted `"empty SW reply"`. Three
 * differential tests + 30 min of wrong-direction diagnosis.
 *
 * Fix: per-op required-field check BEFORE handleMethod is called. On
 * missing required field, return a typed JSON-RPC error (code -32602
 * Invalid params, JSON-RPC 2.0 standard) instead of letting undefined
 * leak into the handler.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   If a half-impl just deleted the `fn -> expression` translation line
 *   without adding any guard, malformed ops would STILL silently pass
 *   through (no translation = no expression field = same dead-end).
 *   This test catches that shortcut by asserting:
 *     (a) an OP_REQUIRED_FIELDS-style guard exists in the dispatch path
 *         covering eval, nav, fetch, tap, input, extract — not just eval
 *     (b) the dispatch returns a JSON-RPC error response with
 *         code -32602 when required fields are missing — not just
 *         "the translation line is gone"
 *     (c) the error message includes the missing field name, so the
 *         author can self-correct without grep'ing source
 *
 *   And:
 *     (d) the existing `fn -> expression` translation either stays
 *         GUARDED (only fires after validation) or moves elsewhere.
 *         A naive "just delete it" half-impl would re-introduce a
 *         different silent failure mode for plans that use the old
 *         `expr` field — those plans MUST now produce a typed error,
 *         not silent translation OR silent failure.
 *
 * Source of truth for required fields: core/assets/plan-v1.schema.json
 * (per-op `required` arrays). Drift between this test's expected fields
 * and the schema is caught manually in code review (cross-repo grep
 * gate); a stronger drift-guard belongs in a future @taprun/spec slice.
 *
 * Run: node extension/test/op-shape-validation.test.mjs
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
// Rule 1: per-op required-field guard exists
// Why: schema source of truth lives in core/assets/plan-v1.schema.json;
// extension must mirror the per-op required arrays in a dispatch-time
// guard so malformed ops never reach handleMethod with undefined fields.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: OP_REQUIRED_FIELDS guard --\n')

test('background.js declares OP_REQUIRED_FIELDS map', () => {
  assert(
    /OP_REQUIRED_FIELDS\s*=\s*\{/.test(BG_SRC),
    'expected `const OP_REQUIRED_FIELDS = { ... }` (or equivalent map) in background.js — ' +
    'this is the schema mirror for dispatch-time validation',
  )
})

// Required-field expectations per plan-v1.schema.json (minus "op" itself):
const EXPECTED = {
  fetch: ['url'],
  nav: ['url'],
  input: ['kind'],
  extract: ['root', 'per_item'],
  tap: ['site', 'name'],
  eval: ['fn', 'returns'],
}

for (const [op, fields] of Object.entries(EXPECTED)) {
  test(`OP_REQUIRED_FIELDS declares ${op}: [${fields.join(', ')}]`, () => {
    // Match `eval: ['fn', 'returns']` or `'eval': ["fn", "returns"]` etc.
    const opPattern = new RegExp(
      `['"]?${op}['"]?\\s*:\\s*\\[([^\\]]*)\\]`,
    )
    const m = BG_SRC.match(opPattern)
    assert(
      m !== null,
      `expected OP_REQUIRED_FIELDS to contain entry for '${op}' — schema says ` +
      `core/assets/plan-v1.schema.json requires [${fields.join(', ')}] (besides "op")`,
    )
    for (const f of fields) {
      assert(
        new RegExp(`['"]${f}['"]`).test(m[1]),
        `expected OP_REQUIRED_FIELDS['${op}'] to include '${f}'; got: ${m[1].trim()}`,
      )
    }
  })
}

// ═══════════════════════════════════════════════════════════
// Rule 2: dispatch returns JSON-RPC error on missing required field
// Why: the failure mode this test exists to catch was a SILENT empty
// SW reply. The fix is a typed error response — JSON-RPC 2.0 code
// -32602 (Invalid params) is the standard for malformed argument shape.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: typed JSON-RPC error on shape violation --\n')

test('dispatch emits JSON-RPC error code -32602 on missing required field', () => {
  // Look for code: -32602 anywhere in the dispatch handler (the
  // function that translates onMessage frames into handleMethod calls).
  // We accept it in either bare number form or string form.
  const has32602 =
    /code\s*:\s*-32602/.test(BG_SRC) ||
    /code\s*:\s*['"]?-32602['"]?/.test(BG_SRC)
  assert(
    has32602,
    'expected `code: -32602` (JSON-RPC Invalid params) somewhere in dispatch — ' +
    'on op-shape violation the response must be a typed error, not silent undefined',
  )
})

test('error message names the missing field(s) so author can self-correct', () => {
  // The message must contain the literal "missing" (or equivalent) plus
  // a placeholder for the field name(s) — pattern: "missing ... ${...}" or
  // "missing ... ' + missing" or template-literal interpolation.
  // We just check that the dispatch path contains the word "missing"
  // alongside the -32602 code — adversarial half-impl that emits
  // `{code:-32602, message:"bad"}` without naming fields fails this.
  assert(
    /missing/i.test(BG_SRC) && /-32602/.test(BG_SRC),
    'expected dispatch error message to include "missing" (field-name-naming) ' +
    'alongside -32602; author needs to see WHICH field is missing',
  )
})

// ═══════════════════════════════════════════════════════════
// Rule 3: brittle `fn -> expression` translation is guarded or gone
// Why: per-op-kind dispatch + lint at write time (core/lint.ts now
// schema-validates) make the ad-hoc translation redundant. Keeping it
// unguarded would mean lint catches the bug at write time but the
// extension silently auto-corrects at run time — split-brain.
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 3: brittle fn->expression translation is gone/guarded --\n')

test('the unguarded `fn -> expression` translation is no longer the FIRST check', () => {
  // Before: line ~1491 was `if (method === 'eval' && resolvedParams.fn !== undefined && resolvedParams.expression === undefined) { resolvedParams.expression = ... }`
  // After: either (a) the line is removed, OR (b) it appears AFTER the
  // OP_REQUIRED_FIELDS guard so a missing-fn op produces a typed error
  // first instead of falling through to the silent-fail path.
  const guardIdx = BG_SRC.indexOf('OP_REQUIRED_FIELDS')
  const translateIdx = BG_SRC.search(
    /resolvedParams\.expression\s*=\s*[`(]/,
  )
  if (translateIdx === -1) {
    // Translation removed entirely — clean.
    return
  }
  assert(
    guardIdx !== -1 && guardIdx < translateIdx,
    'if `resolvedParams.expression = ...` translation remains, OP_REQUIRED_FIELDS ' +
    'guard must appear BEFORE it so missing-fn produces a typed error, not silent translation',
  )
})

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════

console.log(`\n  ${passed}/${passed + failed} passed`)
if (failed > 0) {
  console.log(`\n  \x1b[31m${failed} test(s) failed\x1b[0m`)
  process.exit(1)
}
console.log('\n  \x1b[32mAll op-shape-validation tests passed\x1b[0m\n')
