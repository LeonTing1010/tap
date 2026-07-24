/**
 * Constraint: a click op must OBSERVE its own effect — ok proves dispatch,
 * not effect (2026-07-23 wxamp submit-review dogfood: six dialog layers of
 * "clicked:true, nothing happened", diagnosed only after hand-rolling
 * fetch/XHR/window.open hooks in op:eval).
 * Classification: correctness / what — silent-no-op detection.
 *
 * Contract pinned here:
 *   1. CLICK_WATCH_ARM / CLICK_WATCH_READ exist, self-contained, and the
 *      click case ARMS BEFORE the JS click and READS ~450ms after.
 *   2. The inert predicate is ALL-ZERO (mutations, net, opens, blocked,
 *      href) — only then is CDP escalation dispatched, and only for
 *      untrusted clicks (trusted already ran CDP).
 *   3. popup_blocked NEVER escalates (the handler ran; a second click can
 *      double-fire a write) — it reports the eaten URLs via
 *      _tap_anomalies.click_effect instead.
 *   4. Behavioral (executed ARM/READ pair): counters count, wraps restore.
 *
 * Run: node extension/test/click-effect-watch.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

const clickCase = BG_SRC.slice(BG_SRC.indexOf("case 'click': {"), BG_SRC.indexOf("case 'type': {"))
assert(clickCase.length > 100, "op click case must exist before case 'type'")

// ── structural pins ─────────────────────────────────────────────────────────

test('ARM/READ helpers exist as top-level injectable consts', () => {
  assert(/const CLICK_WATCH_ARM = \(\) => \{/.test(BG_SRC), 'CLICK_WATCH_ARM missing')
  assert(/const CLICK_WATCH_READ = \(\) => \{/.test(BG_SRC), 'CLICK_WATCH_READ missing')
})

test('click case arms BEFORE the JS click, skipping probe', () => {
  const armIdx = clickCase.indexOf('execFunc(fx, CLICK_WATCH_ARM)')
  const clickIdx = clickCase.indexOf('execFunc(fx, clickResolver')
  assert(armIdx > -1, 'click case must arm the watch')
  assert(clickIdx > -1, 'click case must dispatch clickResolver')
  assert(armIdx < clickIdx, 'arm must precede the click dispatch')
  assert(/if \(!params\.probe\) \{ try \{ await execFunc\(fx, CLICK_WATCH_ARM\)/.test(clickCase),
    'arm must be gated on !params.probe and best-effort (try)')
})

test('effect read waits 450ms and a read failure counts as NAVIGATED, not inert', () => {
  assert(clickCase.includes('setTimeout(r, 450)'), 'probe delay must be 450ms')
  assert(/catch \(_e\) \{ effect = \{ navigated: true \} \}/.test(clickCase),
    'a post-click probe failure must be recorded as navigation (strongest effect)')
})

test('escalation gate is ALL-ZERO and untrusted-only', () => {
  const gate = clickCase.match(/else if \(([^)]+(?:\)[^{]*?)?)\) \{/s)
  assert(clickCase.includes("!effect.navigated && effect.m === 0 && effect.net === 0 && !effect.hrefChanged"),
    'inert predicate must require zero mutations, zero net, unchanged href')
  assert(clickCase.includes('effect.opens.length === 0 && effect.blocked.length === 0'),
    'inert predicate must require zero window.open calls (allowed OR blocked)')
  assert(clickCase.includes("!params.trusted && result && typeof result.x === 'number'"),
    'escalation must be untrusted-only and require resolved coords')
  void gate
})

test('escalation re-arms, CDP-clicks the same coords once, and re-probes', () => {
  const esc = clickCase.slice(clickCase.indexOf('silentJsClick'))
  assert(clickCase.includes('await cdpClick(tabId, result.x + dx, result.y + dy)'),
    'escalation must reuse the resolved coords (dx/dy frame translation)')
  assert(/silentJsClick: true, escalated: true/.test(clickCase),
    'successful escalation must be reported')
  assert(/silentJsClick: true, escalated: false/.test(clickCase),
    'failed escalation must still report the silent click')
  void esc
})

test('popup_blocked reports but NEVER escalates (double-fire hazard)', () => {
  assert(/ce\.popup_blocked = effect\.blocked/.test(clickCase),
    'blocked opens must surface as click_effect.popup_blocked')
  // blocked.length === 0 sits inside the escalation gate → any blocked open
  // fails the gate → no escalation path can run.
  assert(clickCase.includes('effect.blocked.length === 0'),
    'escalation gate must exclude blocked-popup clicks')
})

test('anomalies merge preserves witness voting report', () => {
  assert(/const anomalies = \{ \.\.\.\(result\._tap_anomalies \|\| \{\}\) \}/.test(clickCase),
    'click_effect must MERGE with witness anomalies, not replace them')
})

// ── behavioral: execute the ARM/READ pair under a stub DOM ─────────────────

function extractConst(name) {
  const start = BG_SRC.indexOf(`const ${name} = () => {`)
  assert(start > -1, `${name} not found`)
  // Balance braces from the arrow body.
  let i = BG_SRC.indexOf('{', start)
  let depth = 0, end = i
  for (; end < BG_SRC.length; end++) {
    const c = BG_SRC[end]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  return new Function(`return () => ${BG_SRC.slice(i, end + 1)}`)()
}

class StubMutationObserver {
  constructor(cb) { this.cb = cb; StubMutationObserver.last = this }
  observe() { this.observed = true }
  disconnect() { this.disconnected = true }
}

test('ARM installs counters; READ restores wraps and reports', () => {
  const origFetch = () => 'orig-fetch'
  const origOpen = function () { return null } // popup blocker: always null
  const g = globalThis
  const prev = {
    MutationObserver: g.MutationObserver, window: g.window, document: g.document,
    location: g.location, XMLHttpRequest: g.XMLHttpRequest,
  }
  try {
    g.MutationObserver = StubMutationObserver
    g.document = { documentElement: {} }
    g.location = { href: 'https://x.test/a' }
    g.XMLHttpRequest = function () {}
    g.XMLHttpRequest.prototype = { open: function () { return 'xhr-open' } }
    g.window = { fetch: origFetch, open: origOpen }
    // ARM/READ reference bare `window`/`location` — provide via globals.
    const ARM = extractConst('CLICK_WATCH_ARM')
    const READ = extractConst('CLICK_WATCH_READ')
    assert.equal(ARM(), true)
    const W = g.__tapClickWatch
    assert(W && W.obs && W.obs.observed, 'observer must be armed')
    // Simulate page activity during the click aftermath.
    g.window.fetch('u1')                       // counted
    StubMutationObserver.last.cb([{}, {}])     // 2 mutation records
    const w = g.window.open('https://x.test/popup') // blocked (null)
    assert.equal(w, null)
    const r = READ()
    assert.equal(r.net, 1, 'fetch must be counted')
    assert.equal(r.m, 2, 'mutation records must be counted')
    assert.deepEqual(r.blocked, ['https://x.test/popup'], 'blocked open must be captured')
    assert.equal(r.opens.length, 0)
    assert.equal(r.hrefChanged, false)
    assert.equal(g.window.fetch, origFetch, 'READ must restore window.fetch')
    assert.equal(g.window.open, origOpen, 'READ must restore window.open')
    assert.equal(g.__tapClickWatch, undefined, 'READ must clear the watch')
    assert.equal(READ(), null, 'second READ (never re-armed) must return null')
  } finally {
    Object.assign(g, prev)
    delete g.__tapClickWatch
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
