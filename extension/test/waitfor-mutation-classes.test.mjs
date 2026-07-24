/**
 * Constraint: op:wait{selector} must wake on EVERY mutation class that can
 * satisfy its condition — not only childList.
 * Classification: correctness / what — wait-condition completeness.
 *
 * Why (2026-07-23 wxamp submit-review dogfood): waiting on
 * `input.…__checkbox:not(:checked)` timed out twice while op:input resolved
 * the same target seconds later. Two real mutation classes never fired the
 * childList-only observer:
 *   (a) dialog open/close = class/style ATTRIBUTE toggles on pre-existing
 *       nodes (weui keeps every dialog mounted, display-toggled);
 *   (b) `:checked` / `:disabled` = PROPERTY state, which emits NO mutation
 *       record of any kind — only a poll can see it.
 *
 * Pins:
 *   1. the waitFor observer passes attributes:true;
 *   2. a bounded interval poll (250ms) re-checks hit() independently;
 *   3. every resolution path funnels through one `done()` that disconnects
 *      the observer AND clears both timers (no leaked interval after the
 *      wait resolves or times out);
 *   4. behavioral: a property-only change (no mutation record) resolves the
 *      wait via the poll arm.
 *
 * Run: node extension/test/waitfor-mutation-classes.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

const waitForCase = BG_SRC.slice(BG_SRC.indexOf("case 'waitFor': {"), BG_SRC.indexOf("case 'waitForNetwork': {"))
assert(waitForCase.length > 100, 'waitFor case must exist')

test('observer watches attributes, not only childList', () => {
  assert(/childList: true, subtree: true, attributes: true/.test(waitForCase),
    'waitFor MutationObserver must observe attribute mutations (dialog display toggles)')
})

test('an interval poll covers property-state selectors (:checked has no mutation record)', () => {
  assert(/const iv = setInterval\(\(\) => \{ if \(hit\(\)\) done\(true\) \}, 250\)/.test(waitForCase),
    'waitFor must poll hit() every 250ms — the only observer for property state')
})

test('single done() clears observer + interval + timeout on every path', () => {
  assert(/const done = \(v\) => \{ obs\.disconnect\(\); clearInterval\(iv\); clearTimeout\(timer\); resolve\(v\) \}/.test(waitForCase),
    'all resolution paths must funnel through one cleanup-complete done()')
  assert(/setTimeout\(\(\) => done\(false\), timeout\)/.test(waitForCase), 'timeout path must use done(false)')
  assert(/new MutationObserver\(\(\) => \{ if \(hit\(\)\) done\(true\) \}\)/.test(waitForCase),
    'observer path must use done(true)')
})

// ── behavioral: extract the injected wait fn and drive a property change ───

function extractWaitFn() {
  const marker = 'const found = await execFunc(tabId, (sel, timeout) => {'
  const start = BG_SRC.indexOf(marker)
  assert(start > -1, 'injected wait fn not found')
  const fnStart = BG_SRC.indexOf('(sel, timeout)', start)
  let i = BG_SRC.indexOf('{', fnStart)
  let depth = 0, end = i
  for (; end < BG_SRC.length; end++) {
    const c = BG_SRC[end]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  return new Function(`return (sel, timeout) => ${BG_SRC.slice(i, end + 1)}`)()
}

class NeverFiringObserver {
  // Models mutation class (b): property changes emit NO records.
  observe() {}
  disconnect() {}
}

await testAsync('property-only change (zero mutation records) resolves via the poll arm', async () => {
  const g = globalThis
  const prev = { MutationObserver: g.MutationObserver, document: g.document }
  try {
    g.MutationObserver = NeverFiringObserver
    let checked = false
    g.document = {
      documentElement: {},
      querySelector: (sel) => {
        assert.equal(sel, 'input:checked')
        return checked ? { tag: 'input' } : null
      },
    }
    const waitFn = extractWaitFn()
    const p = waitFn('input:checked', 5000)
    // Flip the PROPERTY after 300ms — no mutation record fires.
    setTimeout(() => { checked = true }, 300)
    const t0 = Date.now()
    const found = await p
    assert.equal(found, true, 'wait must resolve on the poll arm')
    assert(Date.now() - t0 < 2000, 'resolution must come from the 250ms poll, not the timeout')
  } finally {
    Object.assign(g, prev)
  }
})

await testAsync('timeout still resolves false and clears the interval', async () => {
  const g = globalThis
  const prev = { MutationObserver: g.MutationObserver, document: g.document }
  try {
    g.MutationObserver = NeverFiringObserver
    g.document = { documentElement: {}, querySelector: () => null }
    const waitFn = extractWaitFn()
    const t0 = Date.now()
    const found = await waitFn('never-matches', 700)
    assert.equal(found, false)
    assert(Date.now() - t0 >= 650, 'must wait out the budget')
    // Leaked-interval canary: give a poll tick a chance to throw after
    // resolution (querySelector on a torn-down document would surface as an
    // unhandled rejection and fail the process).
    g.document = null
    await new Promise(r => setTimeout(r, 400))
  } finally {
    Object.assign(g, prev)
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
