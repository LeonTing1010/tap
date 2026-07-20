/**
 * Constraint: a resolver MISS names the stage that killed it, and the
 * frame hint is only offered when the selector has not already taken the
 * frame hop. [safety/what]
 *
 * Why (2026-07-20 dogfood): every miss read
 *   `selector_not_found: iframe >>> #q (top-frame resolve found nothing —
 *    … the target is inside an iframe: prefix the selector, e.g.
 *    iframeSel >>> innerSel)`
 * on a selector that ALREADY carried ` >>> `. Two failures compounded:
 *   1. the message conflated "matched nothing" with "matched, then the
 *      `visible` filter emptied the list" — the node existed, its panel was
 *      an inactive wizard step so its box was 0×0;
 *   2. the remedy it suggested was the one already applied, so the reader
 *      re-checked frames twice before discovering visibility.
 * Cost: two wrong hypotheses and ~15 probe round-trips on a live console.
 *
 * ADVERSARIAL: an impl that merely appended "or check visibility" to the
 * old string would still be generic. These tests demand DISCRIMINATION —
 * different causes must produce different text, and the frame hint must
 * DISAPPEAR when inapplicable.
 *
 * Run: node extension/test/resolver-diagnosis.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import './_install-deep.mjs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

globalThis.getComputedStyle = (el) => ({
  display: el.__display || 'block', visibility: 'visible', opacity: '1',
})
globalThis.innerHeight = 800
globalThis.innerWidth = 1200

function makeEl(id, { w = 40, h = 20, text = '', label = null, tag = 'BUTTON' } = {}) {
  return {
    __id: id, tagName: tag, textContent: text, children: [], classList: [],
    offsetParent: w > 0 && h > 0 ? {} : null,
    getAttribute: (n) => (n === 'aria-label' ? label : null),
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ x: 5, y: 5, width: w, height: h, top: 5, left: 5, right: 5 + w, bottom: 5 + h }),
    getClientRects: () => (w > 0 && h > 0 ? [{}] : []),
    querySelectorAll: () => [],
  }
}

function docOf(list) {
  return { querySelectorAll: () => list, getElementById: () => null }
}

const diag = globalThis.__tapDeep.diag

// ── the two worlds must read differently ────────────────────────────────
test('D1 — selector matched nothing says so plainly', () => {
  const out = diag({ selector: '#nope' }, docOf([]))
  assert.match(out, /selector matched 0/, `got: ${out}`)
  assert.doesNotMatch(out, /survived/, 'must not imply a filter was involved')
})

test('D2 — matched-then-filtered-by-visible names the stage AND the box', () => {
  // The exact 2026-07-20 shape: node present, collapsed to 0×0.
  const collapsed = makeEl('q', { w: 0, h: 0 })
  const out = diag({ selector: '#questionEle_0 li' }, docOf([collapsed]))
  assert.match(out, /matched 1, 0 survived/, `must report survivors, got: ${out}`)
  assert.match(out, /visible 1→0/, `must name the visible stage, got: ${out}`)
  assert.match(out, /0×0 box/, `must name the concrete cause, got: ${out}`)
  assert.match(out, /offsetParent=null/, `must surface the collapse tell, got: ${out}`)
})

test('D3 — a name-filter miss reports the accessible name it actually saw', () => {
  const el = makeEl('b', { label: 'Cancel' })
  const out = diag({ selector: 'button', name: 'Submit' }, docOf([el]))
  assert.match(out, /name 1→0/, `got: ${out}`)
  assert.match(out, /first casualty name: "Cancel"/, `got: ${out}`)
})

test('D4 — nth out of range is not reported as "not found"', () => {
  const el = makeEl('only')
  const out = diag({ selector: 'button', nth: 4 }, docOf([el]))
  assert.match(out, /matched 1 but nth=4 is out of range/, `got: ${out}`)
})

test('D5 — diagnosis never throws on a hostile element', () => {
  const hostile = {
    tagName: 'DIV', textContent: '', children: [], classList: [],
    offsetParent: null,
    getAttribute: () => null, hasAttribute: () => false,
    getBoundingClientRect() { throw new Error('boom') },
    getClientRects: () => [],
    querySelectorAll: () => [],
  }
  const out = diag({ selector: 'div' }, docOf([hostile]))
  assert.equal(typeof out, 'string', 'diagnosis must degrade, never throw')
})

// ── the hint must stop lying ────────────────────────────────────────────
const msgSrc = BG_SRC.slice(BG_SRC.indexOf('function notFoundMsg'))
const notFoundMsg = new Function(
  'FRAME_SEP',
  `${msgSrc.slice(0, msgSrc.indexOf('\n}') + 2)}; return notFoundMsg`,
)(' >>> ')

test('D6 — an already-framed selector is NOT told to add a frame prefix', () => {
  const out = notFoundMsg('iframe >>> #questionEle_0 li')
  assert.doesNotMatch(out, /prefix the selector/, `the remedy was already applied, got: ${out}`)
  assert.match(out, /resolved inside the named frame/, `got: ${out}`)
  assert.match(out, /visible/, 'should point at the likelier cause')
})

test('D7 — a bare selector keeps the frame hint (it is the right guess there)', () => {
  const out = notFoundMsg('#questionEle_0')
  assert.match(out, /prefix the selector/, `got: ${out}`)
})

test('D8 — a page-side stage diagnosis wins over any generic hint', () => {
  const out = notFoundMsg('iframe >>> #x', 'matched 2, 0 survived [visible 2→0]')
  assert.match(out, /matched 2, 0 survived/, `got: ${out}`)
  assert.doesNotMatch(out, /page may still be loading/, 'generic text must not dilute a real diagnosis')
})

test('D9 — all four throw sites route through notFoundMsg (no re-typed copies)', () => {
  const inlined = (BG_SRC.match(/top-frame resolve found nothing/g) || []).length
  assert.equal(inlined, 1, 'the literal may exist ONLY inside notFoundMsg')
  const routed = (BG_SRC.match(/throw new Error\(notFoundMsg\(/g) || []).length
  assert.equal(routed, 4, `all four selector_not_found sites must call notFoundMsg, found ${routed}`)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
