/**
 * Constraint: 'notify' dispatches WITHOUT a bound tab
 * Classification: safety / what — a tab-gated notify makes every alert-only
 *                 plan (fetch + notify, e.g. kb/alert-* thesis-monitor
 *                 breach notifications, 2026-07-12 migration) die with
 *                 "No active tab" despite the handler never touching tabId.
 *
 * The notify handler writes chrome.storage.local['tap:notify'] for the side
 * panel — storage-only, tab-free by implementation. core reclassified the op
 * TAB_FREE the same day (tap-core src/test/notify_tab_free_test.ts, mirror
 * of op:extract's 2026-06-11 reclassification); this guard pins the
 * extension half: 'notify' must be in the noTabNeeded dispatch list, else
 * the core/extension halves disagree and tab-free dispatch dies at the SW.
 *
 * ADVERSARIAL framing (Phase 1a): a half-fix could make the notify CASE
 * tolerate a null tabId while leaving the gate before the switch — the op
 * would still throw before reaching the handler. Asserting on the
 * noTabNeeded list itself pins the gate, not the handler.
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

test("'notify' is in the noTabNeeded dispatch list", () => {
  const m = BG_SRC.match(/const noTabNeeded = \[([\s\S]*?)\]/)
  assert.ok(m, 'noTabNeeded list must exist in background.js')
  assert.ok(
    /['"]notify['"]/.test(m[1]),
    "'notify' missing from noTabNeeded — tab-free op:notify dispatch dies at the SW gate " +
      '(core classifies notify TAB_FREE per tap-core notify_tab_free_test.ts)',
  )
})

test("the notify handler never touches tabId (stays storage-only)", () => {
  const m = BG_SRC.match(/case 'notify': \{([\s\S]*?)\n    \}/)
  assert.ok(m, "case 'notify' must exist")
  assert.ok(
    !/\btabId\b/.test(m[1]),
    'notify handler must stay tab-free — referencing tabId would invalidate the noTabNeeded listing',
  )
})
