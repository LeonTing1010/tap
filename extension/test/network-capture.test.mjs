/**
 * Constraint: the network capture buffer a plan's op:extract{from:"network"}
 * reads is WRITE-TEMPLATING-faithful — the request is journaled with its
 * authenticity headers, not just its URL.
 * Issue: tap-core#67 (capture-tap → op:fetch write templating).
 *
 * Why: the op:fetch templating recipe needs method + url + headers + body
 * (ADR 2026-07-23 supplied method/url/status/body via inspect.network*);
 * without requestHeaders an author cannot template the SAPISIDHASH
 * authorization, x-csrf-token or content-type variant a replay needs — and
 * CANNOT safely carry Cookie either (repo law: cookies re-supply at replay
 * via credentials:page-session; a cookie in flow JSON is cleartext
 * credential sprawl).
 *
 * Structural pins (write-oracle sibling style):
 *   1. headers captured at requestWillBeSent (responseReceived lacks them)
 *   2. Cookie/Set-Cookie stripped at the source, values capped
 *   3. entry assembly merges requestHeaders (empty object, never undefined)
 *   4. buffer ring-bounded (oldest-first drop, new entries survive)
 *   5. per_item projection can lift the whole header map via one attr read
 *
 * Run: node extension/test/network-capture.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

const LISTENER = (() => {
  const start = BG_SRC.indexOf("method === 'Network.requestWillBeSent'", BG_SRC.indexOf('capture?.listening'))
  const end = BG_SRC.indexOf("method === 'Network.loadingFinished'", start)
  return BG_SRC.slice(start, end)
})()

const ENTRY = (() => {
  const start = BG_SRC.indexOf('capture.entries.push({')
  const end = BG_SRC.indexOf('NETWORK_CAPTURE_MAX', start)
  return BG_SRC.slice(start, end)
})()

test('headers are captured at requestWillBeSent (responseReceived lacks them)', () => {
  assert(LISTENER.includes('requestHeaders: sanitizeRequestHeaders(params.request?.headers)'),
    'the metaMap entry must stash sanitized request headers at request time')
})

test('Cookie / Set-Cookie stripped at the source; values capped', () => {
  const fn = BG_SRC.slice(BG_SRC.indexOf('function sanitizeRequestHeaders'), BG_SRC.indexOf('async function handleWriteRequestEvent'))
  assert(/^cookie\$|set-cookie/im.test(fn.replace(/\s/g, '')) || fn.includes("cookie$"),
    'the filter must drop cookie headers')
  assert(/set-cookie/i.test(fn), 'response-side Set-Cookie must not leak via a stray key either')
  assert(fn.includes('slice(0, 4096)'), 'values must be capped (malformed huge header cannot blow the dump)')
})

test('entry assembly merges requestHeaders — never undefined', () => {
  assert(ENTRY.includes('requestHeaders: meta?.requestHeaders || {}'),
    'entries must carry the header map (empty object when unmergable), so per_item attr reads never return undefined')
})

test('buffer is ring-bounded (cap constant + oldest-first splice)', () => {
  assert(BG_SRC.includes('const NETWORK_CAPTURE_MAX ='),
    'the cap must be a named constant, not a magic number inline')
  assert(/capture\.entries\.length > NETWORK_CAPTURE_MAX\)/.test(BG_SRC),
    'the push site must enforce the cap')
  assert(/splice\(0, capture\.entries\.length - NETWORK_CAPTURE_MAX\)/.test(BG_SRC),
    'drop oldest-first (journal semantics: the chased request is recent)')
})

test('per_item projection lifts the whole map with one attr read', () => {
  const start = BG_SRC.indexOf("params.from === 'network'")
  const stop = BG_SRC.indexOf('inspect.networkDump', start)
  assert(start !== -1 && stop !== -1, 'network projection block must exist')
  const networkProj = BG_SRC.slice(start, stop + 2000)
  assert(networkProj.includes("entry[spec.attr] ?? ''"),
    'the network projection reads entry[attr] — so per_item {headers: {attr: "requestHeaders"}} returns the map verbatim')
})

test('sanitize helper sits before the event listener it serves', () => {
  const helper = BG_SRC.indexOf('function sanitizeRequestHeaders')
  const listener = BG_SRC.indexOf("chrome.debugger.onEvent.addListener((source, method, params)")
  assert(helper !== -1 && listener !== -1 && helper < listener,
    'helper must be in scope (hoisted function declarations work, placement keeps review honest)')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
