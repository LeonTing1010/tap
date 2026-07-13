/**
 * Constraint: an uncaught PAGE exception during an op is REPORTED, not silent.
 * Classification: quality / what — ADR 2026-07-13-cdp-native-execution slice 6.
 *
 * Why: an op can succeed MECHANICALLY (click dispatched, eval returned a value)
 * while the page's own handler throws — the intended effect never lands, yet the
 * op outcome is success-shaped. That is the vacuous-success blind spot. With the
 * Runtime domain enabled (enablePageDomain), Runtime.exceptionThrown surfaces the
 * throw; same discipline as native dialogs (RC4): auto-observed but never silent.
 * Ring-buffer per tab; the next op response drains it into
 * result._tap_anomalies.page_exception (core lifts the whole _tap_anomalies bag
 * into the OpResult envelope, so the reserved key rides for free).
 *
 * Structural pins (mirror dialog-anomaly, the sibling pattern):
 *   1. Runtime domain enabled so the event fires at all
 *   2. handlePageExceptionEvent records {message, url, line, at} per tab, only
 *      for Runtime.exceptionThrown, only for a real tabId
 *   3. buffer bounded (last 5) and cleared on tab close
 *   4. the op success path drains via attachPageExceptionAnomalies AFTER dialogs
 *      and BEFORE withVisibleFrame (same result object)
 *   5. non-object results / unknown tabs / empty buffer pass through untouched
 *
 * Run: node extension/test/page-exception-anomaly.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

test('Runtime domain is enabled so exceptionThrown fires', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function enablePageDomain'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes("'Runtime.enable'"),
    'enablePageDomain must enable the Runtime domain (no enable → no exceptionThrown event)')
})

test('handlePageExceptionEvent records the throw per tab, event-gated', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function handlePageExceptionEvent'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(/method !== 'Runtime\.exceptionThrown'/.test(body),
    'must ignore every CDP event except Runtime.exceptionThrown')
  assert(body.includes("typeof source?.tabId !== 'number'"),
    'must drop events with no real tabId (no cross-tab bleed)')
  assert(body.includes('pendingPageExceptions.get(source.tabId)'),
    'exceptions must land in the per-tab ring buffer')
  assert(body.includes('exception?.description') && body.includes('d.text'),
    'message must derive from exceptionDetails (description, falling back to text)')
  assert(body.includes('.slice(0, 160)'),
    'message must be truncated (log hygiene)')
})

test('buffer is bounded and cleared on tab close', () => {
  assert(BG_SRC.includes('pendingPageExceptions.set(source.tabId, list.slice(-5))'),
    'ring buffer must keep only the last 5')
  assert(/chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => pendingPageExceptions\.delete\(tabId\)\)/.test(BG_SRC),
    'tab close must clear the buffer (no leak, no cross-tab bleed)')
})

test('op success path drains into _tap_anomalies.page_exception, after dialogs, before frame', () => {
  assert(/const withExceptions = attachPageExceptionAnomalies\(withDialogs, resolvedParams\.tabId\)/.test(BG_SRC),
    'the daemon-op success path must drain page exceptions off the dialogs result')
  assert(/_tap_anomalies: \{ \.\.\.\(result\._tap_anomalies \|\| \{\}\), page_exception: evs \}/.test(BG_SRC),
    'drained events must ride the reserved anomaly key core lifts')
  const drain = BG_SRC.indexOf('attachPageExceptionAnomalies(withDialogs')
  const dialogs = BG_SRC.indexOf('attachDialogAnomalies(result')
  const frame = BG_SRC.indexOf('withVisibleFrame(withAnomalies')
  assert(dialogs < drain && drain < frame,
    'order must be dialogs → page-exception → visible-frame (one result object)')
})

test('pass-through safety: non-object results and unknown tabs untouched', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('function attachPageExceptionAnomalies'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes("typeof tabId !== 'number'") && body.includes('!evs || !evs.length'),
    'unknown tab / empty buffer must return the result unchanged')
  assert(body.includes("typeof result !== 'object'") && body.includes('Array.isArray(result)'),
    'non-object results must never be spread into an object')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
