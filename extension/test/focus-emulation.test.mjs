/**
 * Constraint: every debugger attach enables focus + active-lifecycle emulation,
 * so a background tab behaves as focused/foreground. [safety/what]
 *
 * Why: the recurring "background tab isn't real enough" footgun family —
 * 小红书 publish gates on document.visibilityState; gesture-bound framework
 * buttons need foreground; hidden tabs throttle rAF/timers. CDP
 * Emulation.setFocusEmulationEnabled makes the renderer report focus without the
 * OS window being focused (Puppeteer/Playwright's background-drive mechanism);
 * Page.setWebLifecycleState('active') lifts throttling. Wired into the SINGLE
 * attach path (enablePageDomain, called by ensureDebugger on both the fresh and
 * already-attached branches) so trusted clicks / uploads / eval on background
 * tabs all get real focus.
 *
 * This is BEHAVIORAL-via-source (background.js isn't node-importable — chrome.*):
 * it asserts the wiring exists and is best-effort. A half-impl that added the
 * helper but never called it from the attach path fails the wiring assertion.
 *
 * Runtime verification (focus actually emulated) requires a live Chrome — this
 * guard prevents the wiring from being deleted, not the CDP behavior.
 *
 * Run: node extension/test/focus-emulation.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

function slice(marker, n) {
  const i = SRC.indexOf(marker)
  assert(i !== -1, `${marker} not found`)
  return SRC.slice(i, i + n)
}

test('enableFocusEmulation sends setFocusEmulationEnabled + setWebLifecycleState', () => {
  const body = slice('async function enableFocusEmulation(', 700)
  assert(body.includes('Emulation.setFocusEmulationEnabled'), 'must enable focus emulation')
  assert(body.includes('enabled: true'), 'focus emulation must be enabled:true')
  assert(body.includes("Page.setWebLifecycleState") && body.includes("'active'"),
    'must set web lifecycle state active')
})

test('focus emulation is best-effort (both commands in try/catch, benign)', () => {
  const body = slice('async function enableFocusEmulation(', 700)
  const tries = (body.match(/try\s*\{/g) || []).length
  assert(tries >= 2, 'each CDP command must be individually try/caught (benign on old Chrome)')
})

test('attach path wires it: enablePageDomain calls enableFocusEmulation', () => {
  const body = slice('async function enablePageDomain(', 300)
  assert(body.includes('enableFocusEmulation('),
    'enablePageDomain (the single attach hook, both branches) must call enableFocusEmulation')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
