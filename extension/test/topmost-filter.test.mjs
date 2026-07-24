/**
 * Constraint: `topmost: true` keeps only candidates that actually RECEIVE a
 * pointer event at their center (elementFromPoint hit-test).
 * Classification: correctness / what — stacked-dialog disambiguation.
 *
 * Why (2026-07-23 wxamp submit-review dogfood): weui admin consoles keep
 * every dialog MOUNTED — four flow dialogs displayed at once, each with a
 * same-class primary button, all passing `visible`. Resolution then leans on
 * fragile text/nth gymnastics; `topmost` states the intent directly: the one
 * the user could actually click.
 *
 * Pins:
 *   1. resolveList applies topAt after inViewport (schema pipeline order);
 *   2. hit === candidate, hit inside candidate, and candidate inside hit all
 *      pass; an OCCLUDED candidate fails;
 *   3. off-viewport candidates pass (nothing to hit-test; click's own
 *      scroll runs before coordinates are taken);
 *   4. behavioral: two stacked same-class buttons — pick with topmost
 *      returns the top one even when the occluded one is first in DOM order.
 *
 * Run: node extension/test/topmost-filter.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { tapDeep } from './_install-deep.mjs'

const DEEP_SRC = readFileSync(new URL('../tap-deep.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

test('pipeline order: topmost filters after inViewport, before nth', () => {
  const i = DEEP_SRC.indexOf('if (target.inViewport) list = list.filter(inView)')
  const j = DEEP_SRC.indexOf('if (target.topmost) list = list.filter(topAt)')
  assert(i > -1 && j > i, 'topmost must run after inViewport in resolveList')
})

test('diag names a topmost casualty stage', () => {
  assert(/step\('topmost', topAt\)/.test(DEEP_SRC), 'diag must replay the topmost stage')
})

function makeButton(id, { top = 100 } = {}) {
  const el = {
    id,
    tagName: 'BUTTON',
    textContent: '继续提交',
    children: [],
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    contains: (o) => o === el,
    getRootNode: () => globalThis.document,
    getBoundingClientRect: () => ({ x: 10, y: top, width: 100, height: 30, top, bottom: top + 30, left: 10, right: 110 }),
  }
  return el
}

function withDom(fn) {
  const g = globalThis
  const prev = { document: g.document, getComputedStyle: g.getComputedStyle, innerHeight: g.innerHeight, innerWidth: g.innerWidth }
  try { fn() } finally { Object.assign(g, prev) }
}

test('stacked same-class buttons: topmost picks the interactable one, not DOM order', () => {
  withDom(() => {
    const occluded = makeButton('under') // earlier in DOM order
    const top = makeButton('over')
    globalThis.innerHeight = 800
    globalThis.innerWidth = 1200
    globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' })
    globalThis.document = {
      documentElement: {},
      querySelectorAll: (sel) => sel === 'button.primary' ? [occluded, top] : [],
      elementFromPoint: () => top, // the stack's top wins the hit-test
    }
    const noTopmost = tapDeep.pick({ selector: 'button.primary' }, globalThis.document)
    assert.equal(noTopmost.id, 'under', 'without topmost, DOM order wins (the trap)')
    const withTopmost = tapDeep.pick({ selector: 'button.primary', topmost: true }, globalThis.document)
    assert.equal(withTopmost.id, 'over', 'with topmost, the hit-tested element wins')
  })
})

test('hit inside candidate and candidate inside hit both pass; stranger fails', () => {
  withDom(() => {
    const btn = makeButton('btn')
    const innerSpan = { tagName: 'SPAN' }
    btn.contains = (o) => o === btn || o === innerSpan
    globalThis.innerHeight = 800
    globalThis.innerWidth = 1200
    globalThis.document = { documentElement: {}, elementFromPoint: () => innerSpan }
    assert.equal(tapDeep.topAt(btn), true, 'a hit INSIDE the candidate passes (span in button)')
    const wrapper = { tagName: 'DIV', contains: (o) => o === btn }
    globalThis.document.elementFromPoint = () => wrapper
    assert.equal(tapDeep.topAt(btn), true, 'a hit that CONTAINS the candidate passes (wrapper)')
    const stranger = { tagName: 'DIV', contains: () => false }
    globalThis.document.elementFromPoint = () => stranger
    assert.equal(tapDeep.topAt(btn), false, 'an occluding stranger fails the candidate')
  })
})

test('off-viewport candidate passes (click scrolls before taking coords)', () => {
  withDom(() => {
    const below = makeButton('below', { top: 5000 })
    globalThis.innerHeight = 800
    globalThis.innerWidth = 1200
    globalThis.document = {
      documentElement: {},
      elementFromPoint: () => { throw new Error('must not hit-test off-viewport') },
    }
    assert.equal(tapDeep.topAt(below), true)
  })
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
