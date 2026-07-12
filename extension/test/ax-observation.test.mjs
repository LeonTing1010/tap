/**
 * Constraint: op:ax — the AX tree becomes Tap's closed-shadow EYE.
 * Classification: quality / what — ADR 2026-07-12-op-ax-observation (G5).
 *
 * Why: the pierce machinery (2026-07-10) let the HAND reach closed shadow
 * roots, but observation stayed MAIN-world blind. Accessibility.getFullAXTree
 * is render-based — role + accessible name for closed-shadow content — and
 * had zero call sites before this op. The filter must be pure and honest:
 * ignored/roleless nodes dropped, interactive-only by default, all-roles
 * when the caller filters, bounded candidates (the box-model loop that
 * follows is one CDP call per node).
 *
 * Tests run the REAL shipping helper, extracted verbatim from background.js
 * (the closed-shadow-pierce pattern — no re-typed copy that could drift).
 *
 * Run: node extension/test/ax-observation.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

// ── extract the REAL helper + its role set ────────────────────────────────
function extractBlock(marker, terminator) {
  const start = BG_SRC.indexOf(marker)
  assert(start !== -1, `marker not found: ${marker}`)
  const end = BG_SRC.indexOf(terminator, start)
  return BG_SRC.slice(start, end + terminator.length)
}
const rolesSrc = extractBlock('const AX_INTERACTIVE_ROLES', '])')
const fnSrc = extractBlock('function axPickNodes', '\n}')
const axPickNodes = new Function(`${rolesSrc}; ${fnSrc}; return axPickNodes`)()

// AXNode wire shapes as CDP actually sends them.
const ax = (role, name, id, extra = {}) => ({
  role: { type: 'role', value: role },
  name: { type: 'computedString', value: name },
  backendDOMNodeId: id,
  ...extra,
})

test('default = interactive roles only; ignored/roleless/idless dropped', () => {
  const nodes = [
    ax('RootWebArea', 'Page', 1),                 // structural — dropped
    ax('button', '发布', 2),                      // kept
    ax('StaticText', '发布', 3),                  // non-interactive — dropped
    ax('link', 'Home', 4, { ignored: true }),     // ignored — dropped
    ax('textbox', 'Username', 5),                 // kept
    { role: { value: 'button' }, name: { value: 'no-id' } }, // no backendDOMNodeId — dropped
  ]
  const out = axPickNodes(nodes, {})
  assert.deepEqual(out.map((n) => n.backendDOMNodeId), [2, 5])
  assert.equal(out[0].role, 'button')
  assert.equal(out[0].name, '发布')
})

test('explicit role/name filter searches ALL roles (closed-shadow pill by name)', () => {
  const nodes = [
    ax('genericContainer', '暂存离开 发布', 10), // container carrying both labels
    ax('button', '暂存离开', 11),
    ax('button', '发布', 12),
    ax('StaticText', '发布', 13),                 // non-interactive but name-matches
  ]
  const byName = axPickNodes(nodes, { name: '发布' })
  assert.deepEqual(byName.map((n) => n.backendDOMNodeId), [10, 12, 13],
    'name filter must search beyond the interactive set')
  const byBoth = axPickNodes(nodes, { role: 'button', name: '发布' })
  assert.deepEqual(byBoth.map((n) => n.backendDOMNodeId), [12],
    'role+name pins exactly the actionable pill')
})

test('filters are case-insensitive; names truncate at 80', () => {
  const nodes = [ax('Button', 'X'.repeat(200), 20)]
  const out = axPickNodes(nodes, { role: 'button' })
  assert.equal(out.length, 1)
  assert.equal(out[0].name.length, 80)
})

test('candidates hard-cap at 400 (bounds the per-node box-model loop)', () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => ax('button', `b${i}`, i + 1))
  assert.equal(axPickNodes(nodes, {}).length, 400)
})

test("wiring: case 'ax' routes through withDebugger + getFullAXTree + getBoxModel, and capabilities advertise it", () => {
  const axCase = BG_SRC.slice(BG_SRC.indexOf("case 'ax': {"))
  const block = axCase.slice(0, axCase.indexOf("case 'pdf'"))
  assert(block.includes('Accessibility.getFullAXTree'), 'must read the full AX tree')
  assert(block.includes('DOM.getBoxModel'), 'items must carry viewport coords for trusted clicks')
  assert(block.includes('withDebugger(tabId'), 'CDP access must go through the managed attach')
  assert(/'ax',\n/.test(BG_SRC.slice(BG_SRC.indexOf('supports: ['))), 'capabilities must advertise ax')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
