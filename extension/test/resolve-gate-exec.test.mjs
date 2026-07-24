/**
 * Constraint: the chrome.scripting MAIN-world boundary has two failure modes
 * that the rest of the suite cannot see (it mocks chrome.scripting), so both
 * regressed live on 2026-06-18 while every node test stayed green:
 *
 *   (1) execFunc must not hand `undefined` to chrome.scripting.executeScript —
 *       it rejects undefined args as "Value is unserializable". The resolve-gate
 *       click probe added an optional `probe` arg; a normal click left it
 *       undefined → EVERY non-probe click threw at the executeScript boundary.
 *       Fix: execFunc maps undefined → null positionally (null is serializable;
 *       injected funcs check truthiness so null ≡ undefined for them).
 *
 *   (2) An injected MAIN-world function must NOT signal failure by REJECTING a
 *       promise — chrome.scripting swallows MAIN-world rejections (executeScript
 *       resolves with result===undefined instead of throwing). op:wait's
 *       selector timeout rejected → was lost → op:wait returned ok on a missing
 *       selector, silently defeating its peer-conformance contract AND the
 *       resolve-before-dispatch wait-probe arm (type/fill/setHtml). Fix: the
 *       injected fn RESOLVES a serializable `false` sentinel on timeout; the
 *       throw happens extension-side.
 *
 * Classification: safety / what — both regressions silently dispatch (or block)
 * real mutations; neither is catchable by a chrome.scripting mock.
 *
 * BEHAVIORAL: extracts the real source from background.js and executes it
 * against doubles — a source that reverts either fix fails here.
 *
 * Run: node extension/test/resolve-gate-exec.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// brace-match the body following `marker` (which ends at/just before a `{` or `=>`).
function sliceFn(src, marker, fromChar) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`marker not found: ${marker}`)
  const open = src.indexOf(fromChar, start)
  const braceStart = src.indexOf('{', open)
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  throw new Error(`unbalanced braces after ${marker}`)
}

console.log('\n  -- execFunc never passes undefined to executeScript --\n')

// `async function execFunc(t, func, ...args) { ... }`
const execFuncSrc = 'async function execFunc' +
  sliceFn(BG_SRC, 'async function execFunc', '(')

await test('execFunc exists as the single chrome.scripting wrapper', () => {
  assert(execFuncSrc.includes('chrome.scripting.executeScript'), 'execFunc must wrap executeScript')
})

await test('an undefined trailing arg reaches executeScript as null, not undefined', async () => {
  let captured = null
  const mockChrome = {
    scripting: { executeScript: async (opts) => { captured = opts.args; return [{ result: 'OK' }] } },
  }
  const execFunc = new Function('chrome', `return (${execFuncSrc})`)(mockChrome)
  // click's act path: execFunc(fx, clickResolver, target, params.probe) with probe===undefined
  const ret = await execFunc(123, function () {}, 'button.radius', undefined)
  assert.equal(ret, 'OK', 'execFunc returns result.result')
  assert(captured, 'executeScript was called')
  assert(!captured.some((a) => a === undefined),
    `executeScript args must contain NO undefined (chrome rejects it as unserializable); got ${JSON.stringify(captured)}`)
  assert.equal(captured[1], null, 'the undefined probe arg must be mapped to null positionally')
  assert.equal(captured[0], 'button.radius', 'defined args pass through unchanged at their index')
})

await test('defined args pass through untouched', async () => {
  let captured = null
  const mockChrome = { scripting: { executeScript: async (o) => { captured = o.args; return [{ result: 1 }] } } }
  const execFunc = new Function('chrome', `return (${execFuncSrc})`)(mockChrome)
  await execFunc(1, function () {}, 'sel', true)
  assert.deepEqual(captured, ['sel', true])
})

console.log('\n  -- op:wait injected fn resolves a sentinel, never rejects (MAIN-world swallows rejections) --\n')

// the `(sel, timeout) => { ... }` injected by the waitFor method
const waitInjectedSrc = sliceFn(BG_SRC, '(sel, timeout) =>', '(')

function makeMO() {
  return function MutationObserver() { this.observe = () => {}; this.disconnect = () => {} }
}

await test('absent selector → RESOLVES false (does not reject) on timeout', async () => {
  const doc = { querySelector: () => null, documentElement: {} }
  const fn = new Function('document', 'MutationObserver', `return (${waitInjectedSrc})`)(doc, makeMO())
  // If the fix regressed to reject(), this await throws and the test fails.
  const r = await fn('#absent-xyz', 30)
  assert.equal(r, false, 'timeout must resolve `false` (serializable) so it crosses the MAIN-world boundary')
})

await test('present selector → returns true immediately', async () => {
  const doc = { querySelector: () => ({}), documentElement: {} }
  const fn = new Function('document', 'MutationObserver', `return (${waitInjectedSrc})`)(doc, makeMO())
  const r = await fn('#present', 1000)
  assert.equal(r, true)
})

console.log('\n  -- source guards (deletion-proof) --\n')

await test('execFunc maps undefined → null before executeScript', () => {
  assert.match(execFuncSrc, /=== undefined \? null/,
    'execFunc must map undefined args to null (anti-regression for the click-probe unserializable bug)')
  assert.match(execFuncSrc, /args:\s*safeArgs/,
    'executeScript must receive the sanitized args, not the raw ...args')
})

await test('waitFor timeout resolves(false) and throws extension-side, never reject() in MAIN world', () => {
  assert(!/reject\(new Error\('waitFor timeout/.test(waitInjectedSrc),
    'the injected wait fn must NOT reject on timeout (MAIN-world swallows it) — resolve a sentinel instead')
  // 2026-07-23 (waitfor-mutation-classes): all resolution paths funnel
  // through one cleanup-complete done(v) → resolve(v); timeout passes false.
  assert(/setTimeout\(\(\) => done\(false\), timeout\)/.test(waitInjectedSrc),
    'the injected wait fn must resolve(false) via done(false) on timeout')
  assert(/const done = \(v\) => \{[^}]*resolve\(v\) \}/.test(waitInjectedSrc),
    'done() must resolve the sentinel (never reject)')
  assert(/if \(!found\) throw new Error\('waitFor timeout/.test(BG_SRC),
    'the wait method must throw extension-side when the injected fn reports not-found')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
