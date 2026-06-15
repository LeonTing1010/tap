/**
 * Constraint: op:input kind=blur COMMITS blur-flushing form models even when the
 * Tap'd tab is backgrounded.
 * Classification: correctness / what — a no-op blur silently leaves the framework
 * model empty, so a later save validates empty and the form rejects (popup), even
 * though the DOM .value looks filled.
 *
 * Why this exists (2026-06-15 ccopyright r11 dogfood): register.ccopyright.com.cn
 * #/features wraps each field in a Vue component whose value commits to the submit
 * model (params.<field>) ONLY via the child's blur → $emit('text-block') chain.
 * op:input fill set the DOM .value AND the component's myTextValue (the input event
 * is an explicit dispatchEvent, so it lands), but params.mainFunction stayed 0 — the
 * commit never fired. Root cause: the blur handler relied on programmatic el.blur(),
 * which Chrome only DISPATCHES blur/focusout for when the document has system focus.
 * Taps run while the user is in their terminal, so the tab is backgrounded and
 * el.blur() is an activeElement-clearing no-op that fires NO events.
 *
 * This is BEHAVIORAL, not structural: it extracts the blur handler's injected
 * page-function from background.js source and runs it against a DOM double whose
 * el.blur() fires nothing (the backgrounded-tab condition) and whose framework
 * blur/focusout listeners are registered via addEventListener (as Vue/React do).
 * The constraint: those listeners MUST fire. A handler that only calls el.blur()
 * (the pre-fix shape) leaves them unfired and fails here.
 *
 * Run: node extension/test/blur-dispatch.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// --- Extract the named blur resolver injected into the page. ---
// Marker contract: `const blurResolver = (s) => { ... }` inside the blur case.
function extractBlurResolver(src) {
  const marker = 'const blurResolver = '
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('blurResolver not found — blur handler must define a named, self-contained `const blurResolver = (s) => {…}` (so it injects AND is testable)')
  const arrowBodyStart = src.indexOf('{', src.indexOf('(s)', start))
  let depth = 0, i = arrowBodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(src.indexOf('(s)', start), i) // (s) => { ... }
}

// --- DOM double: a TEXTAREA on a BACKGROUNDED tab. el.blur() clears focus but
//     dispatches NO event (Chrome's real behavior for non-focused documents);
//     framework listeners are attached via addEventListener, like Vue/React. ---
function makeControl() {
  const listeners = {}
  return {
    tagName: 'TEXTAREA',
    fired: {},
    __focused: true,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach((fn) => fn(ev)); this.fired[ev.type] = ev; return true },
    focus() { this.__focused = true },
    blur() { this.__focused = false /* backgrounded tab: NO event dispatched */ },
    getRootNode() { return this.__doc },
  }
}

function run(resolverSrc, doc) {
  function FE(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles) }
  const factory = new Function('document', 'FocusEvent', `return (${resolverSrc})`)
  return factory(doc, FE)('textarea#x')
}

console.log('\n  -- op:input blur commits on a backgrounded tab --\n')

const resolverSrc = (() => { try { return extractBlurResolver(BG_SRC) } catch (e) { return null } })()

test('blurResolver exists as a self-contained named injected fn', () => {
  assert(resolverSrc, 'background.js must define `const blurResolver = (s) => {…}`')
})

test('framework @blur listener fires even when el.blur() dispatches nothing', () => {
  assert(resolverSrc, 'resolver missing (see prior failure)')
  const C = makeControl()
  let blurHandlerRan = false
  C.addEventListener('blur', () => { blurHandlerRan = true })
  const doc = { activeElement: C, querySelector: (s) => (s === 'textarea#x' ? C : null) }
  C.__doc = doc
  const out = run(resolverSrc, doc)
  assert.equal(out.blurred, true, 'handler should report blurred:true')
  assert(!C.__focused, 'el.blur() should still have cleared focus')
  assert(blurHandlerRan, 'the @blur listener MUST fire — a handler that only calls el.blur() leaves it unfired on a backgrounded tab')
})

test('focusout also fires and bubbles (delegated listeners)', () => {
  assert(resolverSrc, 'resolver missing')
  const C = makeControl()
  let focusoutEv = null
  C.addEventListener('focusout', (e) => { focusoutEv = e })
  const doc = { activeElement: C, querySelector: () => C }
  C.__doc = doc
  run(resolverSrc, doc)
  assert(focusoutEv, 'focusout listener MUST fire')
  assert.equal(focusoutEv.bubbles, true, 'focusout must bubble for delegated/parent listeners')
})

test('missing element surfaces as Element not found (→ selector_not_found)', () => {
  assert(resolverSrc, 'resolver missing')
  const doc = { activeElement: null, querySelector: () => null }
  assert.throws(() => run(resolverSrc, doc), /Element not found/)
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
