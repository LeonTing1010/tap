/**
 * Constraint: __tapDeep.pick resolves a TargetResolver object to the ONE
 * intended element via the explicit predicate (visible → text → inViewport →
 * nth), and op:input click routes its OBJECT target through pick. [safety/what]
 *
 * Why (ADR 2026-07-08-target-resolver): a bare CSS selector is a *description*
 * whose FIRST match is often a hidden template/duplicate — the 2026-06-11
 * weixin logout (hidden 退出登录) and the 2026-07-08 `.js_aiImage` cover hang
 * (first of 3 nodes hidden → click no-op → 180s relay timeout). The resolver
 * makes the disambiguation an authorable predicate instead of a memory-
 * dependent data-tap dance. pick is the single source of truth; clickResolver
 * keeps its self-contained bare-string path (visible-click.test.mjs guards it)
 * but delegates the object path here.
 *
 * ADVERSARIAL: a half-impl that added the resolver type but resolved objects
 * via `querySelectorAll(sel)[0]` would return the HIDDEN first match — TR-visible
 * below asserts the visible one; TR-nth-last asserts the LAST (newest); TR-text
 * asserts text disambiguation; TR-oob asserts out-of-range → null (no silent
 * first-match). A first-match impl fails all four.
 *
 * Run: node extension/test/target-resolver.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import './_install-deep.mjs' // installs globalThis.__tapDeep.{all,control,pick}

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// pick's vis/inView read the ambient getComputedStyle / innerHeight — install
// test doubles (in the browser these are MAIN-world globals).
globalThis.getComputedStyle = (el) => ({
  display: el.__display || 'block', visibility: 'visible', opacity: '1',
})
globalThis.innerHeight = 800
globalThis.innerWidth = 1200

function makeEl(id, { display = 'block', w = 40, h = 20, text = '', top = 10 } = {}) {
  return {
    __id: id, __clicked: false, __display: display, textContent: text, children: [],
    getAttribute: () => null, scrollIntoView() {}, click() { this.__clicked = true },
    getBoundingClientRect() {
      return { x: 0, y: top, top, left: 0, width: w, height: h, bottom: top + h, right: w }
    },
  }
}

// A document double whose querySelectorAll returns the full match list, so
// __tapDeep.all(sel, doc) sees every candidate (hidden + visible).
function docOf(list) {
  return {
    body: {}, querySelector: () => list[0] || null, querySelectorAll: () => list,
    createTreeWalker: () => ({ nextNode: () => null }),
  }
}

const { pick } = globalThis.__tapDeep

console.log('\n  -- __tapDeep.pick resolver predicates --\n')

test('TR-visible — visible:true skips the hidden first match', () => {
  const hidden = makeEl('h', { display: 'none' })
  const shown = makeEl('v', { display: 'block' })
  const el = pick({ selector: '.x', visible: true }, docOf([hidden, shown]))
  assert.equal(el && el.__id, 'v', 'must skip hidden, pick the visible one')
})

test('TR-nth-last — nth:-1 picks the LAST match (newest in append order)', () => {
  const a = makeEl('a'), b = makeEl('b'), c = makeEl('c')
  const el = pick({ selector: '.x', nth: -1 }, docOf([a, b, c]))
  assert.equal(el && el.__id, 'c', 'nth:-1 must pick the last match')
})

test('TR-nth-index — nth:1 picks the second (0-based)', () => {
  const a = makeEl('a'), b = makeEl('b'), c = makeEl('c')
  const el = pick({ selector: '.x', nth: 1 }, docOf([a, b, c]))
  assert.equal(el && el.__id, 'b')
})

test('TR-text — text filters by textContent substring', () => {
  const other = makeEl('调整', { text: '调整' })
  const use = makeEl('使用', { text: '使用' })
  const el = pick({ selector: '.ai-image-op-btn', text: '使用' }, docOf([other, use]))
  assert.equal(el && el.__id, '使用', 'must pick the button whose text includes 使用')
})

test('TR-oob — out-of-range nth returns null (no silent first-match)', () => {
  const a = makeEl('a'), b = makeEl('b')
  const el = pick({ selector: '.x', nth: 9 }, docOf([a, b]))
  assert.equal(el, null, 'out-of-range must be null, never the first element')
})

test('TR-string — bare string keeps first-visible contract', () => {
  const hidden = makeEl('h', { display: 'none' })
  const shown = makeEl('v', { display: 'block' })
  const el = pick('.x', docOf([hidden, shown]))
  assert.equal(el && el.__id, 'v')
})

console.log('\n  -- __tapDeep.pick semantic role/name (getByRole) --\n')

function makeRoleEl(tag, { role, ariaLabel, type, href, text = '', display = 'block' } = {}) {
  const attrs = {}
  if (role) attrs.role = role
  if (ariaLabel) attrs['aria-label'] = ariaLabel
  if (type) attrs.type = type
  return {
    __id: text || tag, __clicked: false, __display: display, tagName: tag.toUpperCase(),
    textContent: text, children: [], multiple: false,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => (k === 'href' ? !!href : k in attrs),
    closest: () => null, ownerDocument: null,
    scrollIntoView() {}, click() { this.__clicked = true },
    getBoundingClientRect() { return { x: 0, y: 10, top: 10, left: 0, width: 40, height: 20, bottom: 30, right: 40 } },
  }
}

test('TR-role — role:button matches implicit <button> role, skips non-buttons', () => {
  const div = makeRoleEl('div', { text: 'x' })
  const btn = makeRoleEl('button', { text: 'Go' })
  const el = pick({ role: 'button' }, docOf([div, btn]))
  assert.equal(el && el.__id, 'Go', 'role:button must pick the <button>')
})

test('TR-role-name — role+name pins one control by accessible name', () => {
  const save = makeRoleEl('button', { text: '保存' })
  const publish = makeRoleEl('button', { ariaLabel: '发布', text: '' })
  const el = pick({ role: 'button', name: '发布' }, docOf([save, publish]))
  assert.equal(el && el.getAttribute('aria-label'), '发布', 'name must match aria-label')
})

test('TR-role-implicit — a[href] is link, plain <a> is not', () => {
  const link = makeRoleEl('a', { href: '/x', text: 'home' })
  const anchor = makeRoleEl('a', { text: 'noop' })
  const el = pick({ role: 'link' }, docOf([anchor, link]))
  assert.equal(el && el.__id, 'home', 'only a[href] has the link role')
})

test('TR-role-input — input[type=checkbox] → checkbox role', () => {
  const text = makeRoleEl('input', { type: 'text' })
  const check = makeRoleEl('input', { type: 'checkbox', ariaLabel: 'agree' })
  const el = pick({ role: 'checkbox' }, docOf([text, check]))
  assert.equal(el && el.getAttribute('type'), 'checkbox')
})

console.log('\n  -- within: relational scoping (ADR 2026-07-12-target-resolver-within) --\n')

// Why: the relational query ("the 删除 button INSIDE the card whose text
// includes X") previously forced the eval-marker dance — an op:eval stamping
// data-tap-* + an op:input clicking the marker, a two-op TOCTOU broken by
// any React/Vue re-render between the ops. within resolves it in ONE op.
// ADVERSARIAL: a half-impl that resolved within but ran the outer query on
// document anyway would return delB's sibling reachable from document —
// TR-within asserts the pick comes from INSIDE the scoped card only.
test('TR-within — resolves the outer target INSIDE the within match subtree', () => {
  const delInCardA = makeEl('delA', { text: '删除' })
  const delInCardB = makeEl('delB', { text: '删除' })
  const cardA = makeEl('cardA', { text: '标题X … 删除' })
  const cardB = makeEl('cardB', { text: '其他 … 删除' })
  cardA.querySelectorAll = () => [delInCardA]
  cardB.querySelectorAll = () => [delInCardB]
  const el = pick(
    { selector: '.del', within: { selector: '.card', text: '标题X' } },
    docOf([cardA, cardB]),
  )
  assert.equal(el && el.__id, 'delA', 'must resolve inside the text-matched card only')
})

test('TR-within-miss — unresolved within scope → null (no fallback to document-wide match)', () => {
  const stray = makeEl('stray', { text: '删除' })
  const el = pick(
    { selector: '.del', within: { selector: '.card', text: '不存在的标题' } },
    docOf([stray]),
  )
  assert.equal(el, null, 'scope miss must be a miss, not a silent document-wide fallback')
})

test('TR-within-nested — within chains recursively (section → card → button)', () => {
  const btn = makeEl('btn', { text: '确定' })
  const card = makeEl('card', { text: '目标卡 确定' })
  const section = makeEl('section', { text: '列表区 目标卡 确定' })
  card.querySelectorAll = () => [btn]
  section.querySelectorAll = () => [card]
  const el = pick(
    { selector: 'button', within: { selector: '.card', within: { selector: 'section', text: '列表区' } } },
    docOf([section]),
  )
  assert.equal(el && el.__id, 'btn', 'nested within must scope level by level')
})

console.log('\n  -- op:input click routes OBJECT target through pick --\n')

function extractClickResolver(src) {
  const marker = 'const clickResolver = '
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('clickResolver not found')
  const arrowBodyStart = src.indexOf('{', start)
  let depth = 0, i = arrowBodyStart
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(src.indexOf('(', start), i)
}

test('clickResolver clicks the VISIBLE, LAST match for a resolver object', () => {
  const hidden = makeEl('h', { display: 'none' })
  const v1 = makeEl('v1', { display: 'block' })
  const v2 = makeEl('v2', { display: 'block' }) // the newest visible
  const all = [hidden, v1, v2]
  const fakeDoc = docOf(all)
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter',
    `return (${extractClickResolver(BG_SRC)})`)
  const resolver = factory(fakeDoc, globalThis.getComputedStyle, { SHOW_ELEMENT: 1 })
  resolver({ selector: '.js_aiImage', visible: true, nth: -1 })
  assert(!hidden.__clicked, 'must NOT click the hidden first match (the .js_aiImage footgun)')
  assert(!v1.__clicked, 'must NOT click the earlier visible match')
  assert(v2.__clicked, 'must click the visible, last (newest) match')
})

test('clickResolver object miss throws (no semantic fallback for explicit resolver)', () => {
  const fakeDoc = docOf([])
  const factory = new Function('document', 'getComputedStyle', 'NodeFilter',
    `return (${extractClickResolver(BG_SRC)})`)
  const resolver = factory(fakeDoc, globalThis.getComputedStyle, { SHOW_ELEMENT: 1 })
  let threw = false
  try { resolver({ selector: '.nope', visible: true }) } catch { threw = true }
  assert(threw, 'explicit resolver miss must throw Element not found, not silently fall back')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
