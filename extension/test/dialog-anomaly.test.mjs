/**
 * Constraint: auto-handled native dialogs are REPORTED, not silent.
 * Classification: quality / what — north-star observability (2026-07-12).
 *
 * Why: RC4 (2026-06-11) auto-handles native JS dialogs at the CDP layer so
 * ops don't hang ~3.5min — correct, but SILENT: the agent never learned a
 * dialog fired ("弹窗关没关 tap 看不出来", 2026-07-12). A dismissed confirm
 * the plan never expected is a drift signal. Fix: ring-buffer per tab, and
 * the next op response drains the buffer into result._tap_anomalies.dialogs
 * (core lifts that into the OpResult envelope; agent + session log see it).
 *
 * Structural pins:
 *   1. handleDialogEvent records {type, message, accepted, at} per tab
 *   2. buffer is bounded (last 5) and cleared on tab close
 *   3. the op success path drains via attachDialogAnomalies BEFORE
 *      withVisibleFrame wraps the response
 *   4. non-object results and unknown tabs pass through untouched
 *
 * Run: node extension/test/dialog-anomaly.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

test('handleDialogEvent records the auto-handled dialog per tab', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function handleDialogEvent'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes('pendingDialogEvents.get(source.tabId)'),
    'dialog events must land in the per-tab ring buffer')
  assert(/type: params\?\.type \|\| 'dialog'/.test(body) && body.includes('accepted: accept'),
    'the record must carry {type, accepted} so the agent knows WHAT was auto-decided')
  assert(body.includes(".slice(0, 120)"),
    'dialog message must be truncated (log hygiene)')
})

test('buffer is bounded and cleared on tab close', () => {
  assert(BG_SRC.includes('list.slice(-5)'), 'ring buffer must keep only the last 5')
  assert(/chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => pendingDialogEvents\.delete\(tabId\)\)/.test(BG_SRC),
    'tab close must clear the buffer (no leak, no cross-tab bleed)')
})

test('op success path drains the buffer into _tap_anomalies.dialogs', () => {
  assert(/const withDialogs = attachDialogAnomalies\(result, resolvedParams\.tabId\)/.test(BG_SRC),
    'the daemon-op success path must drain dialog events')
  assert(/_tap_anomalies: \{ \.\.\.\(result\._tap_anomalies \|\| \{\}\), dialogs: evs \}/.test(BG_SRC),
    'drained events must ride the reserved anomaly key core lifts')
  // page-exception drain (ADR 2026-07-13 slice 6) now sits between dialogs and
  // the frame wrap: attachDialogAnomalies(result) → attachPageExceptionAnomalies
  // → withVisibleFrame(withAnomalies). Dialogs still drain before the frame wrap
  // and ride the same result object (page-exception derives from withDialogs).
  assert(BG_SRC.indexOf('attachDialogAnomalies(result') < BG_SRC.indexOf('withVisibleFrame(withAnomalies'),
    'dialog drain must happen before the visible-frame wrap so the frame rides the SAME result object')
})

test('pass-through safety: non-object results and unknown tabs untouched', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('function attachDialogAnomalies'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes("typeof tabId !== 'number'") && body.includes('!evs || !evs.length'),
    'unknown tab / empty buffer must return the result unchanged')
  assert(body.includes("typeof result !== 'object'") && body.includes('Array.isArray(result)'),
    'non-object results must never be spread into an object')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
