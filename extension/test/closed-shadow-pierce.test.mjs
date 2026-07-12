/**
 * Constraint: closed-shadow pierce (shadow-piercing Phase 2, 2026-07-10).
 * Classification: safety / what -- violations re-blind trusted clicks to
 *                 closed shadow roots OR mis-click the wrong inner control.
 *
 * The 2026-07-10 xhs dogfood shape: <xhs-publish-btn> renders its two action
 * pills (暂存离开 / 发布) inside a CLOSED shadow root — host.shadowRoot===null,
 * zero light children, empty textContent. JS-world resolution threw
 * Element-not-found for {selector:'xhs-publish-btn', text:'发布'}, and a bare
 * host-center trusted click landed in the gap BETWEEN the pills (silent
 * no-op). The fix pierces via CDP DOM.getDocument({pierce:true}) and picks
 * the SMALLEST matching shadow descendant (the pill, not the bar).
 *
 * Tests here run the REAL shipping helpers (extracted verbatim from
 * background.js — not a re-typed copy that could drift):
 *   1. findCdpNodeByAttr      — locates the marked host in a pierced tree
 *   2. pierceCandidatesFromCdpTree — text/name matching + specificity order
 *   3. wiring — case 'click' routes Element-not-found + trusted + text/name
 *      through pierceClosedShadowClick; non-trusted / no-discriminator do NOT
 *
 * Run: node extension/test/closed-shadow-pierce.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ok - ${name}`)
  } catch (e) {
    failed++
    console.error(`  FAIL - ${name}\n    ${e.message}`)
  }
}

// ── extract the REAL pure helpers from background.js ──────────────────────
function extractFunction(name) {
  const marker = `function ${name}(`
  const start = BG_SRC.indexOf(marker)
  if (start === -1) throw new Error(`${marker} not found in background.js`)
  const braceStart = BG_SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}
const findCdpNodeByAttr = new Function(`return ${extractFunction('findCdpNodeByAttr')}`)()
// pierceCandidates references nothing external — but its extracted source
// must see findCdpNodeByAttr-free scope; it is self-contained by contract.
const pierceCandidatesFromCdpTree = new Function(`return ${extractFunction('pierceCandidatesFromCdpTree')}`)()

// ── synthetic CDP tree: the xhs-publish-btn shape ──────────────────────────
// <xhs-publish-btn data-tap-pierce="n1">
//   #shadow-root (closed)
//     <div class="bar">            ← subtree text: '暂存离开发布' (matches BOTH)
//       <button><span>暂存离开</span></button>
//       <button class="red"><span>发布</span></button>   ← the wanted pill
//     </div>
const el = (name, attrs, children, shadowRoots) => ({
  nodeId: Math.floor(Math.random() * 1e6),
  nodeType: 1,
  nodeName: name,
  attributes: attrs || [],
  children: children || [],
  ...(shadowRoots ? { shadowRoots } : {}),
})
const txt = (v) => ({ nodeId: 0, nodeType: 3, nodeName: '#text', nodeValue: v })

const pillLeave = el('BUTTON', [], [el('SPAN', [], [txt('暂存离开')])])
const pillPublish = el('BUTTON', ['class', 'red'], [el('SPAN', [], [txt('发布')])])
const bar = el('DIV', ['class', 'bar'], [pillLeave, pillPublish])
const closedRoot = { nodeId: 9, nodeType: 11, nodeName: '#document-fragment', shadowRootType: 'closed', children: [bar] }
const host = el('XHS-PUBLISH-BTN', ['data-tap-pierce', 'n1'], [], [closedRoot])
const docRoot = el('HTML', [], [el('BODY', [], [host])])

// ── 1. findCdpNodeByAttr ────────────────────────────────────────────────────
test('finds the marked host through the pierced tree', () => {
  const n = findCdpNodeByAttr(docRoot, 'data-tap-pierce', 'n1')
  assert.ok(n, 'host not found')
  assert.equal(n.nodeName, 'XHS-PUBLISH-BTN')
})

test('returns null when the nonce does not match', () => {
  assert.equal(findCdpNodeByAttr(docRoot, 'data-tap-pierce', 'other'), null)
})

// ── 2. pierceCandidatesFromCdpTree ─────────────────────────────────────────
test('text match reaches INSIDE the closed shadow root', () => {
  const hits = pierceCandidatesFromCdpTree(host, { text: '发布' })
  assert.ok(hits.length >= 1, 'no candidates found through closed root')
})

test('smallest-subtree-first: picks the 发布 pill, not the bar (and NEVER 暂存离开)', () => {
  const hits = pierceCandidatesFromCdpTree(host, { text: '发布' })
  const first = hits[0]
  // most-specific match is the <span>发布</span> or its <button> — both carry
  // ONLY '发布'; the bar ('暂存离开发布') must sort later.
  const own = JSON.stringify(first)
  assert.ok(own.includes('发布'), 'first candidate must contain 发布')
  assert.ok(!own.includes('暂存离开'), `first candidate must not span the whole bar: ${own.slice(0, 120)}`)
})

test('name matches aria-label inside the shadow', () => {
  const iconBtn = el('BUTTON', ['aria-label', '发布笔记'], [])
  const root2 = { nodeId: 1, nodeType: 11, shadowRootType: 'closed', children: [iconBtn] }
  const host2 = el('X-BAR', ['data-tap-pierce', 'n2'], [], [root2])
  const hits = pierceCandidatesFromCdpTree(host2, { name: '发布' })
  assert.equal(hits.length, 1, 'aria-label name match failed')
})

test('no discriminator → no candidates (never guess which control)', () => {
  assert.deepEqual(pierceCandidatesFromCdpTree(host, {}), [])
  assert.deepEqual(pierceCandidatesFromCdpTree(host, { text: '' }), [])
})

test('no match → empty (falls through to the original error)', () => {
  assert.deepEqual(pierceCandidatesFromCdpTree(host, { text: '不存在' }), [])
})

// ── 3. wiring constraints (source shape) ───────────────────────────────────
test('case click routes the fallback: trusted + text/name + Element-not-found', () => {
  // Two `case 'click':` exist (an inner trace switch + the real handler);
  // the real handler is the LAST one, followed by the real `case 'type':`.
  const clickStart = BG_SRC.lastIndexOf("case 'click':")
  const clickCase = BG_SRC.slice(clickStart, BG_SRC.indexOf("case 'type':", clickStart))
  assert.ok(clickCase.includes('pierceClosedShadowClick'), 'click case must wire the pierce fallback')
  assert.ok(/params\.trusted && !params\.probe/.test(clickCase), 'fallback must gate on trusted + not-probe')
  assert.ok(/t\.text \|\| t\.name/.test(clickCase), 'fallback must require a text/name discriminator')
  assert.ok(/!dx && !dy/.test(clickCase), 'fallback must exclude iframe targets (top-frame coords only)')
})

test('pierceClosedShadowClick marks only opaque hosts and always unmarks', () => {
  const fn = extractFunction('pierceClosedShadowClick')
  assert.ok(BG_SRC.includes('not_opaque_host'), 'PIERCE_MARK must refuse non-opaque hosts')
  assert.ok(fn.includes('PIERCE_UNMARK'), 'must clean the marker attr')
  assert.ok(fn.includes('finally'), 'unmark must run on every path')
  assert.ok(fn.includes('DOM.getContentQuads'), 'must click via content quads (viewport coords)')
})

// ── 4. DIAGNOSE_REACHABILITY — the read-only "why did the resolver miss" probe ──
function extractConstArrow(name) {
  const marker = `const ${name} = `
  const start = BG_SRC.indexOf(marker)
  if (start === -1) throw new Error(`${marker} not found in background.js`)
  const arrowBody = BG_SRC.indexOf('=> {', start)
  let depth = 0
  for (let i = BG_SRC.indexOf('{', arrowBody); i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(BG_SRC.indexOf('(', start), i + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}
const DIAGNOSE_REACHABILITY = new Function(`return ${extractConstArrow('DIAGNOSE_REACHABILITY')}`)()

function withMockDeep(pickResult, fn) {
  const g = globalThis
  const prevDeep = g.__tapDeep
  const prevDoc = g.document
  g.__tapDeep = { pick: () => pickResult }
  g.document = g.document || {} // DIAGNOSE passes `document` as pick's 2nd arg
  try { return fn() } finally { g.__tapDeep = prevDeep; g.document = prevDoc }
}

test('opaque host + text discriminator → closed_shadow (the xhs-publish-btn shape)', () => {
  const opaqueHost = { childElementCount: 0, textContent: '' }
  const r = withMockDeep(opaqueHost, () =>
    DIAGNOSE_REACHABILITY({ selector: 'xhs-publish-btn', text: '发布' }))
  assert.equal(r.reach, 'closed_shadow')
})

test('selector matches nothing at all → absent (likely real drift)', () => {
  const r = withMockDeep(null, () =>
    DIAGNOSE_REACHABILITY({ selector: '#gone', text: 'x' }))
  assert.equal(r.reach, 'absent')
})

test('host has light content → null (resolver-precision miss, not a domain problem)', () => {
  const richHost = { childElementCount: 3, textContent: 'stuff' }
  const r = withMockDeep(richHost, () =>
    DIAGNOSE_REACHABILITY({ selector: '.list', text: 'nope' }))
  assert.equal(r.reach, null)
})

test('opaque host but NO discriminator → null (cannot claim closed_shadow)', () => {
  const opaqueHost = { childElementCount: 0, textContent: '' }
  const r = withMockDeep(opaqueHost, () =>
    DIAGNOSE_REACHABILITY({ selector: 'x-thing' }))
  assert.equal(r.reach, null)
})

test('input catch wires the read-only diagnosis into selector_not_found', () => {
  // Two `case 'input':` exist (visible-trace switch + the real handler); the
  // real one is the LAST, followed by the BUILT-IN divider.
  const inputStart = BG_SRC.lastIndexOf("case 'input':")
  const inputCase = BG_SRC.slice(inputStart, BG_SRC.indexOf("// ==========", inputStart))
  assert.ok(inputCase.includes('DIAGNOSE_REACHABILITY'), 'input catch must run the diagnosis')
  assert.ok(/\[reach=\$\{diag\.reach\}\]/.test(inputCase), 'must append the [reach=..] tag core parses')
  assert.ok(/best-effort/.test(inputCase), 'diagnosis must be best-effort (never mask the original miss)')
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
