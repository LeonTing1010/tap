/**
 * Constraint: the HTTP write a write-op produced is REPORTED — the effect oracle.
 * Classification: quality / what — ADR 2026-07-13-cdp-native-execution slice 4.
 *
 * Why: a DOM readback proves neither persistence nor visibility-to-others; the
 * only cross-site acceptance truth is the HTTP response the action produced. Per
 * RFC 9110, unsafe methods (POST/PUT/PATCH/DELETE) ARE the writes. Capture the
 * request the op fired (method+url at requestWillBeSent) merged with its status
 * (responseReceived), ring-buffered per tab; the next op response drains it into
 * result._tap_anomalies.writes (core lifts the whole bag), so a write's
 * postcondition can assert `...writes` fired 2xx. Observation-only, filtered to
 * unsafe methods so the GET flood never enters the buffer.
 *
 * Structural pins (mirror the anomaly sibling pattern):
 *   1. Network domain enabled so the events fire
 *   2. GET flood dropped at the listener; only WRITE_METHODS tracked
 *   3. request (method+url) merged with response status by requestId
 *   4. buffer bounded (last 10), meta bounded (clear >50), cleared on tab close
 *   5. drain into _tap_anomalies.writes, after exceptions, before the frame wrap
 *   6. pass-through safety: non-object results / unknown tabs / empty buffer
 *
 * Run: node extension/test/write-oracle.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

test('Network domain is enabled so request/response events fire', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function enablePageDomain'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes("'Network.enable'"), 'enablePageDomain must enable the Network domain')
})

test('only unsafe (write) methods are tracked — GET flood dropped', () => {
  assert(/WRITE_METHODS = new Set\(\['POST', 'PUT', 'PATCH', 'DELETE'\]\)/.test(BG_SRC),
    'the write set must be exactly the RFC 9110 unsafe methods')
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function handleWriteRequestEvent'))
  const body = fn.slice(0, fn.indexOf('\n}\nchrome'))
  assert(body.includes('!WRITE_METHODS.has(m)') && body.includes('return'),
    'requestWillBeSent must drop non-write methods at the source (no GET flood in the buffer)')
})

test('request meta merged with response status by requestId', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('async function handleWriteRequestEvent'))
  const body = fn.slice(0, fn.indexOf('\n}\nchrome'))
  assert(body.includes("method === 'Network.requestWillBeSent'") && body.includes('pendingWriteMeta'),
    'method+url must be captured at requestWillBeSent (responseReceived lacks the method)')
  assert(body.includes("method === 'Network.responseReceived'") && body.includes('response?.status'),
    'status must be merged from responseReceived, keyed by requestId')
})

test('buffers bounded and cleared on tab close', () => {
  assert(BG_SRC.includes('list.slice(-10)'), 'write ring buffer keeps last 10')
  assert(BG_SRC.includes('meta.size > 50') && BG_SRC.includes('meta.clear()'),
    'the per-tab requestId meta map must be bounded (no leak on a chatty page)')
  assert(/pendingWriteMeta\.delete\(tabId\); pendingWriteEvents\.delete\(tabId\)/.test(BG_SRC),
    'tab close must clear both write maps')
})

test('op success path drains into _tap_anomalies.writes, after exceptions, before frame', () => {
  assert(/const withAnomalies = attachWriteAnomalies\(withExceptions, resolvedParams\.tabId\)/.test(BG_SRC),
    'the daemon-op success path must drain writes off the exceptions result')
  assert(/_tap_anomalies: \{ \.\.\.\(result\._tap_anomalies \|\| \{\}\), writes: evs \}/.test(BG_SRC),
    'drained writes must ride the reserved anomaly key core lifts')
  const exc = BG_SRC.indexOf('attachPageExceptionAnomalies(withDialogs')
  const wr = BG_SRC.indexOf('attachWriteAnomalies(withExceptions')
  const frame = BG_SRC.indexOf('withVisibleFrame(withAnomalies')
  assert(exc < wr && wr < frame, 'order must be exceptions → writes → visible-frame')
})

test('pass-through safety: non-object results and unknown tabs untouched', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('function attachWriteAnomalies'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert(body.includes("typeof tabId !== 'number'") && body.includes('!evs || !evs.length'),
    'unknown tab / empty buffer must return the result unchanged')
  assert(body.includes("typeof result !== 'object'") && body.includes('Array.isArray(result)'),
    'non-object results must never be spread into an object')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
