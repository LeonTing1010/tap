/**
 * host-op.test.mjs — op:host generic interpreter (Lane B).
 * ADR 2026-07-16-primitive-set-narrow-waist-and-thin-host-capability-registry.
 *
 * The Lane-B guarantee is the ABSENCE of per-cap code: op:host runs
 * chrome.<namespace>.<method>(...) from the core-resolved `_cap`, so adding a
 * capability is a registry edit (core/assets/host-caps.json), never a change
 * to this handler. These source assertions pin that absence.
 *
 * Run: node extension/test/host-op.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

function slice(marker, len) {
  const i = BG.indexOf(marker)
  assert(i >= 0, `marker not found: ${marker}`)
  return BG.slice(i, i + len)
}

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

console.log('\nop:host generic interpreter (Lane B)\n')

test("case 'host' handler exists", () => {
  assert(BG.includes("case 'host': {"), 'op:host handler must exist')
})

const body = (() => {
  // Structure, not a character budget: this was slice("case 'host': {", 1300),
  // and adding explanatory comments to the handler pushed the very lines these
  // tests assert on out of the window — a guard going red for code that still
  // satisfied every property it claims to check. Third instance of that trap in
  // one day (see architecture.test.mjs withDebugger, and background.js's own
  // 700-char frame-piercing note).
  const i = BG.indexOf("case 'host': {")
  const j = BG.indexOf("case 'cookies': {", i)
  return BG.slice(i, j > i ? j : i + 4000)
})()

test('reads the core-resolved _cap (extension keeps NO registry copy)', () => {
  assert(body.includes('params._cap'), 'must read params._cap')
})

test('generic dispatch — chrome[namespace][method], with NO per-cap branch', () => {
  assert(body.includes('chrome[spec.namespace]'), 'must index chrome by namespace')
  assert(body.includes('spec.method'), "must call the spec's method")
  // Adversarial (Phase 1a): a handler that branched on a cap name would
  // defeat Lane B. No cap name may appear in the handler body.
  assert(!body.includes('tab-reload'), 'handler must NOT hardcode a cap name')
})

test('defense-in-depth namespace allowlist (mirrors core HOST_CAP_NAMESPACES)', () => {
  // Pinned as a literal on purpose: this is a CROSS-REPO mirror, and the
  // whole point is that widening core's list without widening this one (or
  // vice versa) turns red HERE. 2026-08-04: added `tabGroups` — the manifest
  // already grants the permission and none of its methods can take the
  // user's focus (update takes {collapsed,color,title}; move takes
  // {index,windowId}), which is the admission rule for a host-caps
  // namespace. Widening again requires the same two-sided edit.
  assert(
    body.includes("new Set(['tabs', 'windows', 'tabGroups'])"),
    'must guard the namespace against arbitrary chrome-API invocation',
  )
})

test('the namespace allowlist admits nothing that can take OS focus', () => {
  // The registry maps method NAMES and cannot constrain argument VALUES, so
  // admission is decided per-namespace on the worst parameter a caller could
  // pass. `chrome.tabs.update` / `chrome.windows.update` carry `active` /
  // `focused`; they are reachable-by-namespace but must never be REGISTERED
  // as caps — enforced on the core side (host-caps.json has no entry for
  // them). Here we pin the extension half of the contract: focus-taking must
  // stay in hand-written code with a visible call site, which today is
  // `ensureForeground`, used only where Chrome itself demands foreground.
  const hostCase = body.slice(body.indexOf("case 'host':"))
  const handler = hostCase.slice(0, hostCase.indexOf("case 'cookies':"))
  assert(
    !handler.includes('ensureForeground') && !handler.includes('active: true'),
    'op:host must never foreground a tab — that would make focus theft a data edit',
  )
})

// The dotted-path test retired 2026-08-04 with the feature: its only caller
// was chrome.contentSettings.notifications.get, and that permission was
// withdrawn as unearned. Keeping the guard would pin a capability nothing uses.


console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
