/**
 * W4 — extension WIRE_CODE map must match core/wire-codes.ts exactly.
 *
 * Per ADR `2026-05-05-daemon-sw-via-websocket.md` §3 W4. Drift between
 * extension and daemon's understanding of JSON-RPC error codes is the
 * exact failure mode that produced Bug 2 in the long-poll era. This
 * test reads BOTH copies of the table and asserts they agree.
 *
 * Run: node extension/test/wire_codes.test.mjs
 *
 * Assumes the project layout has `core/core/wire-codes.ts` adjacent
 * to `public/extension/`. Skipped if the core copy isn't reachable
 * (e.g. extension distributed standalone).
 */

import { strict as assert } from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

// Extract WIRE_CODE block from background.js.
const bgMatch = BG_SRC.match(/const WIRE_CODE = (\{[^}]+\})/)
assert(bgMatch, 'background.js must declare const WIRE_CODE = {...}')
const bgTable = parseSimpleObject(bgMatch[1])

// Locate core copy. Drift guard: if core/ is reachable, both must agree.
const coreUrl = new URL('../../../core/core/wire-codes.ts', import.meta.url)
let corePath
try {
  corePath = coreUrl.pathname
} catch {
  corePath = null
}

if (!corePath || !existsSync(corePath)) {
  console.log('W4: core/wire-codes.ts not reachable from this checkout; skipping drift check')
  process.exit(0)
}

const CORE_SRC = readFileSync(corePath, 'utf-8')
const coreMatch = CORE_SRC.match(/export const WIRE_CODE: Record<OpErrorKind, number> = (\{[^}]+\})/s)
assert(coreMatch, 'core/wire-codes.ts must export WIRE_CODE')
const coreTable = parseSimpleObject(coreMatch[1])

// Compare keys + values.
const bgKeys = Object.keys(bgTable).sort()
const coreKeys = Object.keys(coreTable).sort()
assert.deepEqual(
  bgKeys,
  coreKeys,
  `WIRE_CODE keys differ:\n  extension: ${bgKeys.join(',')}\n  core:      ${coreKeys.join(',')}`,
)
for (const k of bgKeys) {
  assert.equal(
    bgTable[k],
    coreTable[k],
    `WIRE_CODE['${k}'] differs: extension=${bgTable[k]} core=${coreTable[k]}`,
  )
}
console.log(`W4: extension WIRE_CODE matches core/wire-codes.ts (${bgKeys.length} entries)`)

// Tiny parser for `{ key: -32xxx, ... }` style objects (no nested braces).
function parseSimpleObject(src) {
  const out = {}
  for (const line of src.split('\n')) {
    const m = line.match(/(\w+)\s*:\s*(-?\d+)/)
    if (m) out[m[1]] = parseInt(m[2], 10)
  }
  return out
}
