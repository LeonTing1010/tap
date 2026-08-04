/**
 * Constraint: 'host' dispatches WITHOUT a bound tab
 * Classification: safety / what — op:host is a HOST op (it drives the user's
 *                 own browser harness: chrome.tabs / chrome.windows), so it
 *                 has no page and no tab to bind. core has listed it in
 *                 TAB_FREE_OP_NAMES since it shipped; the extension's
 *                 `noTabNeeded` gate did not, so every op:host dispatched
 *                 from a flow died with "No active tab" BEFORE reaching the
 *                 handler — including the one shipped capability
 *                 (`tab-reload`). Discovered 2026-08-04 by the first flow to
 *                 use op:host for real (a background browser-UI probe:
 *                 tab-zoom-set). The failure is invisible to both repos'
 *                 suites in isolation, which is precisely the cross-repo
 *                 desync ADR 2026-07-16 §6 records as having no gate.
 *
 * ADVERSARIAL framing (Phase 1a): a half-fix could make the `host` CASE
 * tolerate a null tabId while leaving the gate before the switch untouched —
 * the op would still throw before reaching the handler. Asserting on the
 * noTabNeeded list itself pins the GATE, not the handler. The second test
 * pins the other direction: the handler must stay tab-free, otherwise the
 * listing would be a lie in the opposite sense.
 */
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

test("'host' is in the noTabNeeded dispatch list", () => {
  const m = BG_SRC.match(/const noTabNeeded = \[([\s\S]*?)\]/)
  assert.ok(m, 'noTabNeeded list must exist in background.js')
  assert.ok(
    /['"]host['"]/.test(m[1]),
    "'host' missing from noTabNeeded — tab-free op:host dispatch dies at the SW gate " +
      '(core classifies host TAB_FREE in TAB_FREE_OP_NAMES)',
  )
})

test('the host handler never touches tabId (stays harness-only)', () => {
  const m = BG_SRC.match(/case 'host': \{([\s\S]*?)\n    \}/)
  assert.ok(m, "case 'host' must exist")
  assert.ok(
    !/\btabId\b/.test(m[1]),
    'op:host handler must stay tab-free — a tabId reference would invalidate the noTabNeeded listing. ' +
      'A capability that needs a tab takes it as a registry-declared ARG (params: ["tabId", ...]), ' +
      'which arrives through params.args, not through the dispatch-level bound tab.',
  )
})
