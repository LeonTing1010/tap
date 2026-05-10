/**
 * Constraint: popup correctly renders bridge connection state.
 * Classification: quality / what -- violations mean the user sees the wrong
 * status when the bridge is up/down, breaking the #1 traffic page setup flow
 * (taprun.dev/blog/bridge-disconnect-setup).
 *
 * Scope: pure state-rendering logic in popup.js, plus structural invariants
 * in popup.html. Visual regression (CSS, icons, layout) is NOT covered —
 * see TESTING.md for manual release-checklist note.
 *
 * Approach: hand-rolled minimal DOM + chrome.runtime stub. Matches the
 * extension/test/ "zero deps, just node:assert + readFileSync" convention.
 * Adding jsdom would break that pattern for ~6 DOM APIs of actual usage.
 *
 * Run: node extension/test/popup.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const HTML_SRC = readFileSync(new URL('../popup.html', import.meta.url), 'utf-8')
const JS_SRC = readFileSync(new URL('../popup.js', import.meta.url), 'utf-8')

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

// ─── Static: popup.html structural invariants ────────────────────────────

test('popup.html declares #connected section', () => {
  assert.match(HTML_SRC, /id="connected"/, 'missing #connected section')
})

test('popup.html declares #disconnected section', () => {
  assert.match(HTML_SRC, /id="disconnected"/, 'missing #disconnected section')
})

test('popup.html both sections start hidden (background SW resolves state)', () => {
  // Both sections must have `hidden` attribute initially — popup.js flips
  // exactly one of them based on actual status. Without `hidden`, user sees
  // a flash of both states before the first sendMessage resolves.
  const sections = HTML_SRC.match(/<section[^>]*>/g) ?? []
  for (const s of sections) {
    if (s.includes('id="connected"') || s.includes('id="disconnected"')) {
      assert.match(s, /\bhidden\b/, `section missing hidden attribute: ${s}`)
    }
  }
})

test('popup.html disconnected section cites canonical bridge command', () => {
  // Per 5/9 traffic memo, this IS the #1 traffic page promise. The exact
  // command the user is told to run must match what the CLI actually exposes.
  // Today: `tap bridge start` (per popup.html). If the CLI verb changes,
  // this test fails — forcing a paired update.
  assert.match(HTML_SRC, /tap bridge start/, 'disconnected section missing `tap bridge start` command')
})

test('popup.html install link carries UTM params (per memory: always-utm-external-shares)', () => {
  assert.match(HTML_SRC, /utm_source=chrome-ext/, 'install link missing utm_source=chrome-ext')
  assert.match(HTML_SRC, /utm_campaign=popup/, 'install link missing utm_campaign=popup')
})

// ─── Static: popup.js wiring invariants ──────────────────────────────────

test('popup.js polls bridge status (live state flip while popup open)', () => {
  // 5/9 setup flow depends on this: user opens popup, sees disconnected,
  // runs `tap bridge start` in terminal, popup must flip to connected
  // without re-opening.
  assert.match(JS_SRC, /setInterval\(\s*refresh\s*,\s*2000\s*\)/, 'missing setInterval(refresh, 2000)')
})

test('popup.js cleans up interval on unload (no leak)', () => {
  assert.match(JS_SRC, /clearInterval\(tick\)/, 'missing clearInterval on unload')
})

test('popup.js handles chrome.runtime.lastError as disconnected', () => {
  // Background SW can be asleep; the popup must NOT show stale connected
  // state in that case. Treat any sendMessage error as disconnected.
  assert.match(JS_SRC, /chrome\.runtime\.lastError/, 'missing lastError check')
})

test('popup.js wires retry button → tap-retry message', () => {
  assert.match(JS_SRC, /['"`]tap-retry['"`]/, 'retry handler does not send tap-retry message')
})

// ─── Dynamic: render() state logic via minimal DOM stub ──────────────────

function makeStubDoc() {
  const elements = new Map()
  const make = (id) => ({
    id, hidden: false, textContent: '',
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    addEventListener: () => {},
    disabled: false,
    dataset: {},
  })
  for (const id of ['connected', 'disconnected', 'version', 'retry', 'install']) {
    elements.set(id, make(id))
  }
  return {
    getElementById: (id) => elements.get(id) ?? null,
    addEventListener: () => {},
    _get: (id) => elements.get(id),
  }
}

function loadRender() {
  // Extract just the render() function from popup.js — avoids running the
  // module's setInterval/refresh side effects in test context.
  const match = JS_SRC.match(/function render\(status\) \{[\s\S]*?\n\}/)
  if (!match) throw new Error('could not extract render() from popup.js')
  return match[0]
}

test('render(connected:true) shows #connected, hides #disconnected', () => {
  const doc = makeStubDoc()
  const $connected = doc._get('connected')
  const $disconnected = doc._get('disconnected')
  const $version = doc._get('version')

  // Eval render() against stub-bound locals — replicates how popup.js
  // captures elements once at module top.
  const fn = new Function('document', '$connected', '$disconnected', '$version',
    `${loadRender()}; return render;`)(doc, $connected, $disconnected, $version)

  fn({ connected: true, version: '0.15.11' })
  assert.equal($connected.hidden, false, '#connected should be visible')
  assert.equal($disconnected.hidden, true, '#disconnected should be hidden')
  assert.equal($version.textContent, 'v0.15.11', 'version text not set')
})

test('render(connected:false) shows #disconnected, hides #connected', () => {
  const doc = makeStubDoc()
  const $connected = doc._get('connected')
  const $disconnected = doc._get('disconnected')
  const $version = doc._get('version')
  const fn = new Function('document', '$connected', '$disconnected', '$version',
    `${loadRender()}; return render;`)(doc, $connected, $disconnected, $version)

  fn({ connected: false })
  assert.equal($connected.hidden, true, '#connected should be hidden')
  assert.equal($disconnected.hidden, false, '#disconnected should be visible')
})

test('render(undefined) falls back to disconnected (SW asleep case)', () => {
  const doc = makeStubDoc()
  const $connected = doc._get('connected')
  const $disconnected = doc._get('disconnected')
  const $version = doc._get('version')
  const fn = new Function('document', '$connected', '$disconnected', '$version',
    `${loadRender()}; return render;`)(doc, $connected, $disconnected, $version)

  fn(undefined)
  assert.equal($connected.hidden, true, 'undefined status must hide #connected')
  assert.equal($disconnected.hidden, false, 'undefined status must show #disconnected')
})

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
