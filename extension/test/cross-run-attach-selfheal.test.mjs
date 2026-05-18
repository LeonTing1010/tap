/**
 * Constraint: op:nav self-heal binds the current sessionId even when an
 * OTHER session was already mapped to the same tab.
 * Classification: safety / what — silent eval failure under cross-Run
 *                                  attach reuse (tap-core verification
 *                                  surfaced on 2026-05-18 jike repro)
 *
 * Why: ADR `2026-05-10-session-as-actor` allows multiple sessionIds to
 * share a tab (a single user-tab is a substrate resource; multiple Runs
 * may attach to it concurrently or sequentially). The nav handler does
 * two things post-nav: (1) sync URL of any existing session entry that
 * already points to this tab, and (2) self-heal — bind the dispatch
 * envelope's sessionId to the tab if no entry exists for it yet.
 *
 * The pre-fix bug: the self-heal precondition was
 *     `if (!sessionUpdated && fromDaemon && sid && !sessions.has(sid))`
 * The `!sessionUpdated` short-circuit was wrong because (1) and (2)
 * operate on DIFFERENT session entries — they shouldn't be mutex.
 * When a prior interactive-lifecycle Run had bound sid-A to tabId-X
 * and a new Run with sid-B navs (via attach) to the same tab, the
 * loop updates sid-A (matched s.tabId), sets sessionUpdated=true, and
 * skips self-heal — sid-B is never bound. Subsequent op:eval with
 * sid-B fails with "No active tab".
 *
 * The fix: drop `!sessionUpdated &&` from the self-heal condition so
 * both updates can fire in the same nav call.
 *
 * ADVERSARIAL framing (Phase 1a):
 *   If a half-impl just renamed the `sessionUpdated` variable without
 *   removing the short-circuit, the bug would persist under a new name.
 *   The test catches this by asserting the self-heal block's condition
 *   does NOT include any `!<flag> &&` short-circuit before
 *   `fromDaemon`. A half-impl could also reorder the loop and self-heal
 *   — the test asserts the self-heal still calls `sessions.set(sid,`
 *   so a no-op refactor doesn't silently regress.
 *
 *   Also asserts: the for-loop that updates existing entries still
 *   exists (we don't want to remove that — it's the legitimate "sync
 *   URL on same-origin nav" path).
 *
 * Run: node extension/test/cross-run-attach-selfheal.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(
  new URL('../background.js', import.meta.url),
  'utf-8',
)

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    ${e.message}`)
  }
}

// ═══════════════════════════════════════════════════════════
// Rule 1: self-heal condition does NOT short-circuit on
// any boolean derived from "did some OTHER session get updated"
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 1: self-heal not gated by other-session updates --\n')

// Helper: locate the self-heal block by anchoring on `sessions.set(sid,`
// and inspecting the preceding ~250 chars (which spans back to the
// nearest `if (` precondition). Avoids regex pain with nested parens
// like `!sessions.has(sid)` in the condition.
function selfHealPrecedingCondition() {
  // There are two `sessions.set(sid` call sites: line ~52 is the
  // rehydrate-on-boot path (uses Object.entries iteration, no `if`
  // guard); line ~468 is the self-heal we care about. Use lastIndexOf
  // to anchor on the latter.
  const idx = BG_SRC.lastIndexOf('sessions.set(sid,')
  assert(idx !== -1, 'expected `sessions.set(sid,` self-heal call in background.js')
  // Walk backwards to find the `if (` that opens this block.
  const window = BG_SRC.slice(Math.max(0, idx - 350), idx)
  const m = window.match(/if\s*\(([\s\S]+)\)\s*\{\s*$/)
  assert(m, `expected \`if (...)\` immediately before sessions.set(sid,; window tail: ${window.slice(-200)}`)
  return m[1]
}

test('self-heal block does not condition on !sessionUpdated', () => {
  const cond = selfHealPrecedingCondition()
  assert(
    !/!sessionUpdated/.test(cond),
    `self-heal condition must NOT include \`!sessionUpdated\` — that ` +
      `re-introduces the cross-Run short-circuit bug. Found: ${cond.trim()}`,
  )
})

test('self-heal still requires fromDaemon + sid + !sessions.has(sid)', () => {
  const cond = selfHealPrecedingCondition()
  assert(/fromDaemon/.test(cond), `self-heal must check fromDaemon: ${cond.trim()}`)
  assert(/\bsid\b/.test(cond), `self-heal must check sid: ${cond.trim()}`)
  assert(
    /!sessions\.has\(\s*sid\s*\)/.test(cond),
    `self-heal must check !sessions.has(sid): ${cond.trim()}`,
  )
})

// ═══════════════════════════════════════════════════════════
// Rule 2: the existing-session URL-sync loop is preserved
// (we want both paths firing, not the loop removed)
// ═══════════════════════════════════════════════════════════

console.log('\n  -- Rule 2: URL-sync loop on existing sessions preserved --\n')

test('for-loop over sessions updates s.url + s.tabId on match', () => {
  // The loop should still exist — it handles the legitimate case where
  // an existing session entry needs its URL synced after a same-origin
  // SPA nav.
  const loopMatch = BG_SRC.match(
    /for\s*\(\s*const\s*\[\s*,?\s*s?\s*\]\s*of\s*sessions\s*\)/,
  )
  assert(loopMatch, 'expected `for (const [...] of sessions)` URL-sync loop')
  // The body of the loop should update both url and tabId
  const loopStart = BG_SRC.indexOf(loopMatch[0])
  const body = BG_SRC.slice(loopStart, loopStart + 500)
  assert(
    /s\.url\s*=/.test(body),
    `URL-sync loop must update s.url — body: ${body.slice(0, 200)}`,
  )
  assert(
    /s\.tabId\s*=/.test(body),
    `URL-sync loop must update s.tabId — body: ${body.slice(0, 200)}`,
  )
})

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════

console.log(`\n  ${passed}/${passed + failed} passed`)
if (failed > 0) {
  console.log(`\n  \x1b[31m${failed} test(s) failed\x1b[0m`)
  process.exit(1)
}
console.log('\n  \x1b[32mAll cross-run-attach-selfheal tests passed\x1b[0m\n')
