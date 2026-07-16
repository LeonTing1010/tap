/**
 * Constraint: __tapDeep.pickVoted — witness voting on a conjunctive resolver
 * MISS (ADR 2026-07-17-reference-metabolism-witness-voting-and-ambient-
 * revalidation). [safety/what]
 *
 * A resolver declaring BOTH witness classes (structural `selector` +
 * semantic `role`/`name`) already paid for redundancy; conjunctive
 * filtering wastes it — either witness drifting kills the plan although
 * the survivor still uniquely identifies the author's intent. Voting rule:
 *   absence ≠ veto; dissent = veto; uniqueness required.
 * The survivor resolves iff it matches EXACTLY ONE element AND the other
 * class matches ZERO. Every fallback resolution carries a witness report
 * (→ _tap_anomalies.witness, lifted by core) — never silent.
 *
 * ADVERSARIAL: a half-impl that "just tries the name when the selector
 * fails" (no uniqueness / no dissent veto) resolves WRONG referents —
 * WV3 (1-vs-1 dissent) and WV4 (non-unique survivor) kill it. One that
 * votes on nth>0 indexes into a drifted list — WV6 kills it. One that
 * reports nothing — WV2's witness assertion kills it.
 *
 * Run: node extension/test/witness-voting.test.mjs
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

/** Element double with role/name support (implicitRole reads role attr /
 *  tagName; accName reads aria-label → textContent). */
function makeEl(id, { display = 'block', text = '', role, label, tag = 'div' } = {}) {
  return {
    __id: id, __display: display, textContent: text, children: [], tagName: tag.toUpperCase(),
    getAttribute: (k) => (k === 'role' ? role ?? null : k === 'aria-label' ? label ?? null : null),
    hasAttribute: () => false,
    scrollIntoView() {}, click() {},
    getBoundingClientRect() { return { x: 0, y: 10, top: 10, left: 0, width: 40, height: 20, bottom: 30, right: 40 } },
  }
}

/** Document double that dispatches per selector: the structural selector
 *  returns `map[sel]`; the ROLE_CANDIDATES common-role query (starts with
 *  'a,area,button') returns `roleSet`. */
function docOf(map, roleSet = []) {
  const q = (sel) => sel.startsWith('a,area,button') ? roleSet : (map[sel] || [])
  return {
    body: {}, querySelector: (s) => q(s)[0] || null, querySelectorAll: q,
    createTreeWalker: () => ({ nextNode: () => null }),
  }
}

const { pickVoted } = globalThis.__tapDeep

console.log('\n  -- __tapDeep.pickVoted witness voting --\n')

test('WV0 — pickVoted is installed', () => {
  assert.equal(typeof pickVoted, 'function', 'TAP_DEEP_INSTALL must export pickVoted')
})

test('WV1 — conjunctive hit: no voting, no witness report (behavior identical to pick)', () => {
  const el = makeEl('ok', { role: 'button', label: '提交' })
  const r = pickVoted({ selector: '.btn', role: 'button', name: '提交' }, docOf({ '.btn': [el] }, [el]))
  assert.equal(r.el && r.el.__id, 'ok')
  assert.equal(r.witness, undefined, 'a hit must carry NO witness report')
})

test('WV2 — selector drifted, semantic witness unique → resolves WITH report', () => {
  // The CSS class churned (selector matches nothing); role+name still
  // uniquely names the element. Absence ≠ veto.
  const el = makeEl('sem', { role: 'button', label: '提交审核' })
  const r = pickVoted(
    { selector: '.css-1x2y3z', role: 'button', name: '提交审核' },
    docOf({ '.css-1x2y3z': [] }, [el, makeEl('other', { role: 'link', label: '返回' })]),
  )
  assert.equal(r.el && r.el.__id, 'sem', 'unique semantic survivor must resolve')
  assert.deepEqual(r.witness, { resolved_by: 'semantic', missing: 'selector' })
})

test('WV3 — dissent (1-vs-1): selector→A, semantic→B → VETO (null)', () => {
  const a = makeEl('A')
  const b = makeEl('B', { role: 'button', label: '提交' })
  const r = pickVoted(
    { selector: '.btn', role: 'button', name: '提交' },
    docOf({ '.btn': [a] }, [b]),
  )
  assert.equal(r.el, null, 'dissenting witnesses must fail loudly, never guess')
})

test('WV4 — non-unique survivor: semantic matches 2 → null', () => {
  const b1 = makeEl('b1', { role: 'button', label: '删除' })
  const b2 = makeEl('b2', { role: 'button', label: '删除' })
  const r = pickVoted(
    { selector: '.gone', role: 'button', name: '删除' },
    docOf({ '.gone': [] }, [b1, b2]),
  )
  assert.equal(r.el, null, 'an ambiguous survivor must not resolve')
})

test('WV5 — semantic absent, selector unique → resolves WITH report', () => {
  // The label text changed (role+name matches nothing); the selector still
  // uniquely identifies the node.
  const el = makeEl('st')
  const r = pickVoted(
    { selector: '#save-btn', role: 'button', name: '旧文案' },
    docOf({ '#save-btn': [el] }, []),
  )
  assert.equal(r.el && r.el.__id, 'st')
  assert.deepEqual(r.witness, { resolved_by: 'selector', missing: 'semantic' })
})

test('WV6 — nth>0 disarms voting (index into a drifted list = arbitrary element)', () => {
  const el = makeEl('sem', { role: 'button', label: '提交' })
  const r = pickVoted(
    { selector: '.gone', role: 'button', name: '提交', nth: 1 },
    docOf({ '.gone': [] }, [el]),
  )
  assert.equal(r.el, null)
})

test('WV7 — single-witness resolvers never vote (selector-only miss stays a miss)', () => {
  const r = pickVoted({ selector: '.gone', visible: true }, docOf({ '.gone': [] }, [makeEl('x')]))
  assert.equal(r.el, null)
})

console.log('\n  -- click path wiring (source) --\n')

test('click object path routes through pickVoted and attaches the witness anomaly', () => {
  const i = BG_SRC.indexOf('const clickResolver = ')
  assert(i >= 0, 'clickResolver missing')
  const body = BG_SRC.slice(i, i + 3000)
  assert(body.includes('pickVoted'), 'object-target resolution must use pickVoted')
  assert(body.includes('_tap_anomalies') && body.includes('witness'),
    'a fallback resolution must ride the _tap_anomalies.witness channel (core lifts it)')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
