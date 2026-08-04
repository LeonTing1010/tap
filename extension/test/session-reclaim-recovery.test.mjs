/**
 * Constraint: reattach-once recovery covers EVERY CDP op, not just clicks
 * Classification: safety / what — MV3 can silently reclaim a debugger session
 *                 while `debuggerSessions` still says attached:true, so
 *                 `ensureDebugger` no-ops and the next sendCommand throws
 *                 "Debugger is not attached" / "Detached while handling
 *                 command". A recovery for this existed since 2026-06-15 —
 *                 but only inside `cdpClick`. Every other CDP-backed op
 *                 (op:pdf export, op:screenshot, op:ax, focusEmulate) routes
 *                 through `withDebugger`, which had no recovery at all, so a
 *                 reclaimed session killed them outright on a perfectly
 *                 healthy tab. Found 2026-08-04 by a browser-UI sweep flow
 *                 whose op:pdf failed with exactly that message.
 *
 * ADVERSARIAL framing (Phase 1a): the tempting half-fix is to add a second
 * hand-rolled retry inside `case 'pdf'`. That fixes one op and leaves ax /
 * screenshot / focusEmulate broken, and it creates a THIRD spelling of "is
 * this session reclaimed?" free to drift from the other two. So the tests
 * below pin (a) the recovery living in withDebugger — the shared chokepoint —
 * and (b) exactly ONE predicate, referenced by both call sites.
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

test('withDebugger recovers from a reclaimed session (reattach once)', () => {
  const m = BG_SRC.match(/async function withDebugger\(tabId, fn\) \{([\s\S]*?)\n\}/)
  assert.ok(m, 'withDebugger must exist')
  const body = m[1]
  assert.ok(
    /isSessionReclaimed/.test(body),
    'withDebugger must detect a reclaimed session — else every non-click CDP op dies on it',
  )
  assert.ok(
    /debuggerSessions\.delete\(tabId\)/.test(body) && /ensureDebugger\(tabId\)/.test(body),
    'recovery must clear the stale session entry AND reattach before retrying',
  )
})

test('exactly ONE predicate defines "session reclaimed" (no third spelling)', () => {
  const defs = BG_SRC.match(/const isSessionReclaimed = /g) || []
  assert.equal(defs.length, 1, 'the predicate must be defined exactly once')
  // The literal regex may appear only inside that one definition.
  const inline = BG_SRC.match(/not attached\|detached/g) || []
  assert.equal(
    inline.length,
    1,
    'the "not attached|detached" test must not be hand-rolled at any call site — ' +
      'use isSessionReclaimed so cdpClick and withDebugger cannot drift apart',
  )
})

test('cdpClick uses the shared predicate rather than its own copy', () => {
  const m = BG_SRC.match(/async function cdpClick\(tabId, x, y\) \{([\s\S]*?)\n\}/)
  assert.ok(m, 'cdpClick must exist')
  assert.ok(
    /isSessionReclaimed\(e\)/.test(m[1]),
    'cdpClick must call the shared predicate — its inline regex was the original, and ' +
      'leaving it inline is how the two recoveries start disagreeing',
  )
})
