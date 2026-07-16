/**
 * Constraint: ambient revalidation — browse-as-audit (ADR 2026-07-17-
 * reference-metabolism-witness-voting-and-ambient-revalidation). [safety/what]
 *
 * The resident kernel converts the user's ORGANIC browsing into free
 * binding-freshness audits: bindings recorded when input ops use them,
 * re-resolved (read-only) when the user naturally visits the host,
 * consumed where the agent decides between retry and re-capture (the
 * input-failure detail). T3 — the system can't detect its own staleness —
 * becomes ambient detection, at zero tokens and zero page loads.
 *
 * ADVERSARIAL: a half-impl that probes EVERY page the user visits (no
 * binding gate / no throttle) is a perf+privacy leak — the source
 * assertions pin the host gate and the 6h throttle. One that probes with
 * click/act ops mutates pages the user is reading — the read-only
 * assertion (pick only, no click) kills it. One whose recorder grows
 * unboundedly — the cap eviction test kills it.
 *
 * Run: node extension/test/ambient-revalidation.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

function extractFn(name) {
  const marker = `function ${name}(`
  const start = BG_SRC.indexOf(marker)
  assert(start >= 0, `${marker} not found in background.js`)
  const braceStart = BG_SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

console.log('\n  -- ambient helpers (behavioral, real extracted code) --\n')

const ambientHostOf = new Function(`return ${extractFn('ambientHostOf')}`)()
const ambientDue = new Function(
  'AMBIENT_THROTTLE_MS',
  `return ${extractFn('ambientDue')}`,
)(6 * 3600 * 1000)
const bindingKeyOf = new Function(`return ${extractFn('bindingKeyOf')}`)()

test('AR1 — ambientHostOf normalizes (lowercase, www-strip) and rejects junk', () => {
  assert.equal(ambientHostOf('https://WWW.Example.COM/x?y'), 'example.com')
  assert.equal(ambientHostOf('https://developer.huawei.com/a'), 'developer.huawei.com')
  assert.equal(ambientHostOf('not a url'), null)
  assert.equal(ambientHostOf('chrome://extensions'), 'extensions')
})

test('AR2 — ambientDue: never-probed is due; within-throttle is not; past-throttle is', () => {
  const H6 = 6 * 3600 * 1000
  assert.equal(ambientDue(undefined, 1000), true, 'never probed → due')
  assert.equal(ambientDue(1000, 1000 + H6 - 1), false, 'inside the window → not due')
  assert.equal(ambientDue(1000, 1000 + H6), true, 'window elapsed → due')
})

test('AR3 — bindingKeyOf is stable across property order and drops discriminators it ignores', () => {
  const a = bindingKeyOf({ selector: '.x', name: '提交', role: 'button' })
  const b = bindingKeyOf({ role: 'button', name: '提交', selector: '.x' })
  assert.equal(a, b, 'key must not depend on property order')
  assert.notEqual(a, bindingKeyOf({ selector: '.y', name: '提交', role: 'button' }))
})

console.log('\n  -- recorder (behavioral, chrome.storage mock) --\n')

// recordBinding is `async function` — extractFn's marker starts at
// 'function', so re-prefix async for the await-bearing body.
const recordBinding = new Function(
  'chrome', 'AMBIENT_MAX_BINDINGS_PER_HOST', 'bindingKeyOf', 'ambientHostOf',
  `return async ${extractFn('recordBinding')}`,
)

function mockChrome(store = {}) {
  return {
    _store: store,
    storage: {
      local: {
        get: (k) => Promise.resolve({ [k]: store[k] }),
        set: (obj) => { Object.assign(store, obj); return Promise.resolve() },
      },
    },
  }
}

await atest('AR4 — recordBinding stores by host+witness key and evicts beyond the cap (newest kept)', async () => {
  const chrome = mockChrome()
  const rec = recordBinding(chrome, 3, bindingKeyOf, ambientHostOf)
  // 4 distinct witnesses on one host, cap 3 → oldest evicted.
  for (let i = 0; i < 4; i++) {
    await rec(`https://example.com/p${i}`, { selector: `.w${i}`, role: 'button', name: `n${i}` })
  }
  const hostRec = chrome._store['tap:bindings']['example.com']
  const keys = Object.keys(hostRec.entries)
  assert.equal(keys.length, 3, 'cap must hold')
  assert(!keys.includes(bindingKeyOf({ selector: '.w0', role: 'button', name: 'n0' })),
    'the oldest binding must be evicted')
})

await atest('AR5 — recordBinding ignores bare strings and witness-less objects', async () => {
  const chrome = mockChrome()
  const rec = recordBinding(chrome, 3, bindingKeyOf, ambientHostOf)
  await rec('https://example.com/', '#bare-string')
  await rec('https://example.com/', { text: 'only-a-discriminator' })
  assert.equal(chrome._store['tap:bindings'], undefined, 'nothing recordable → nothing stored')
})

console.log('\n  -- wiring (source assertions) --\n')

test('AR6 — probe is gated on recorded hosts + throttled; listener fires on status complete', () => {
  const i = BG_SRC.indexOf('async function ambientProbe(')
  assert(i >= 0, 'ambientProbe missing')
  const body = BG_SRC.slice(i, i + 2200)
  assert(body.includes("'tap:bindings'"), 'probe must consult the recorded-bindings gate')
  assert(body.includes('ambientDue('), 'probe must respect the throttle')
  assert(BG_SRC.includes("info.status === 'complete'"), 'listener must fire on load complete')
  assert(BG_SRC.includes('chrome.tabs.onUpdated.addListener'), 'organic navigation is the trigger')
})

test('AR7 — probe is READ-ONLY: resolves via pick, never clicks/acts', () => {
  const i = BG_SRC.indexOf('async function ambientProbe(')
  const body = BG_SRC.slice(i, i + 2200)
  assert(body.includes('.pick('), 'probe must resolve via __tapDeep.pick')
  assert(!/\.click\(|dispatchEvent|\.focus\(/.test(body), 'probe must never act on the page')
})

test('AR8 — input-failure detail consumes ambient freshness (staleness lands where the agent decides)', () => {
  assert(BG_SRC.includes("'tap:binding-health'"), 'health store missing')
  const i = BG_SRC.indexOf('ambientFreshnessOf')
  assert(i >= 0, 'ambientFreshnessOf consumer missing')
  // The enrichment rides the same choke point as reachability diagnosis.
  const enrich = BG_SRC.indexOf('ambientFreshnessOf(', BG_SRC.indexOf('DIAGNOSE_REACHABILITY ='))
  assert(enrich >= 0, 'the selector_not_found detail path must append ambient freshness')
})

test('AR9 — the 6h throttle constant is declared (perf/privacy envelope)', () => {
  assert(/AMBIENT_THROTTLE_MS = 6 \* 3600 \* 1000/.test(BG_SRC), 'throttle must be 6h')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
