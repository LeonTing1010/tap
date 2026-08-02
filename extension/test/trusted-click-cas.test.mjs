/**
 * Constraint: a trusted click is a COMPARE-AND-SWAP, not a compare-then-swap-
 * anyway. Classification: safety / what.
 *
 * Why: `trusted-click-hittest.test.mjs` (2026-08-01) made the miss DETECTABLE
 * and its own header states the principle — "hit-testing needs no attribution".
 * But the call site records the miss and dispatches at the stale point anyway:
 *
 *     if (hit === false) hitMiss = { selector, x, y }
 *     await cdpClick(tabId, result.x + dx, result.y + dy)   // ← known-stale
 *
 * The page is a concurrent mutable store: resolving selector → (x,y) is a READ,
 * dispatching at (x,y) is a WRITE. Performing the compare and swapping
 * regardless is a textbook lost update. Measured 2026-08-02 (x.com profile,
 * ADR 2026-08-02-the-oracle-obligation-belongs-to-dispatch §3): the edit-profile
 * button reflowed while banner images loaded, the trusted click landed on empty
 * space, `stale_coords` was reported, and the op still returned ok.
 *
 * A click at a location we have PROVEN is not the target is worse than no
 * click: it is an unattributable side effect somewhere else on the page.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   "If a half-impl passed: (a) it retries the hit test but dispatches at the
 *    end regardless — CAS3 pins dispatch call-count at 0 after exhausting
 *    attempts; (b) it re-tests the SAME stale coordinates instead of
 *    re-resolving — CAS2 moves the element between attempts and asserts the
 *    dispatch point is the NEW one, which a re-test-only impl cannot produce;
 *    (c) it swallows the outcome so the caller cannot tell a miss from a
 *    success — CAS3 asserts a falsy/stale verdict comes back."
 *
 * Run: node extension/test/trusted-click-cas.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractBody(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker.trim()} not found — the CAS loop must be a named, self-contained helper the test can execute`)
  // Body brace, not the destructuring-parameter brace: find the arrow first.
  const arrow = src.indexOf('=> {', start)
  if (arrow === -1) throw new Error(`${marker.trim()} must be an arrow function with a block body`)
  let i = src.indexOf('{', arrow), depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1) }  // BODY only
  }
  throw new Error('unbalanced braces')
}

const SRC = extractBody(BG, 'const casClick = async (')  // body block only
const casClick = eval(`(async ({ resolve, hitTest, dispatch, attempts = 3 }) => ${SRC})`)

await (async () => {
console.log('\ntrusted-click CAS')

await test('CAS1 — a stable target dispatches once, at the resolved point', async () => {
  const dispatched = []
  const r = await casClick({
    resolve: () => ({ x: 10, y: 20 }),
    hitTest: () => true,
    dispatch: (p) => { dispatched.push(p) },
    attempts: 3,
  })
  assert.equal(dispatched.length, 1, 'exactly one dispatch')
  assert.deepEqual(dispatched[0], { x: 10, y: 20 })
  assert.equal(r.dispatched, true)
})

await test('CAS2 — a moved target is RE-RESOLVED; the click lands on the new point, never the stale one', async () => {
  const points = [{ x: 10, y: 20 }, { x: 10, y: 140 }]
  let n = 0
  const dispatched = []
  await casClick({
    resolve: () => points[Math.min(n, points.length - 1)],
    // miss on the first read, hit once we have re-resolved
    hitTest: (p) => { const ok = p.y === 140; n++; return ok },
    dispatch: (p) => { dispatched.push(p) },
    attempts: 4,
  })
  assert.equal(dispatched.length, 1, 'one dispatch after the retry')
  assert.deepEqual(dispatched[0], { x: 10, y: 140 }, 'must be the RE-RESOLVED point')
})

await test('CAS3 — a target that never settles is NOT clicked, and the caller is told', async () => {
  const dispatched = []
  const r = await casClick({
    resolve: () => ({ x: 1, y: 2 }),
    hitTest: () => false,
    dispatch: (p) => { dispatched.push(p) },
    attempts: 3,
  })
  assert.equal(dispatched.length, 0,
    'a click at a point PROVEN not to be the target is an unattributable side effect — never dispatch it')
  assert.equal(r.dispatched, false, 'the caller must be able to tell a miss from a success')
  assert.ok(r.stale, 'the miss must be reported, not swallowed')
})

await test('CAS4 — an undecidable hit test (frame gone / non-CSS target) must not block the click', async () => {
  const dispatched = []
  const r = await casClick({
    resolve: () => ({ x: 5, y: 6 }),
    hitTest: () => null,   // "cannot decide" — never a miss
    dispatch: (p) => { dispatched.push(p) },
    attempts: 3,
  })
  assert.equal(dispatched.length, 1,
    'undecidable is not a miss — refusing here would break every closed-shadow/coords target')
  assert.equal(r.dispatched, true)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
})()
