/**
 * Constraint: before op:nav reloads/navigates an EXISTING tab, the extension
 * neutralizes beforeunload so a dirty page's native "Leave site?" dialog cannot
 * block the navigation.
 * Classification: safety / what — 2026-06-11 weixin dogfood: a dirty self-menu
 *   editor's beforeunload dialog hung op:nav ~3.5 min (native dialogs aren't page
 *   DOM; nothing in the op set can dismiss them, so the relay just waited).
 *
 * Behavioral (extract-and-run): the injected suppressor fn is pulled from
 * background.js source and executed against a fake window. The suppressor MUST
 * (a) null window.onbeforeunload AND (b) register a capturing beforeunload
 * listener that stopImmediatePropagation + clears returnValue (the page's
 * addEventListener('beforeunload') handler — the common modern case — is what
 * onbeforeunload=null alone misses).
 *
 * Phase 1a (adversarial): a half-impl that only does `window.onbeforeunload =
 * null` (today's `case 'dialog'` behavior) passes a grep for "beforeunload" but
 * leaves addEventListener-based handlers firing the dialog. This RUNS the
 * suppressor and invokes the registered listener with a returnValue-setting
 * event — the onbeforeunload-only impl registers no listener and fails.
 *
 * Phase 1b (anchor): WeChat mp's editor guards unsaved changes via
 * addEventListener('beforeunload') (the "Leave site?" seen 2026-06-11), not a
 * window.onbeforeunload assignment.
 *
 * Run: node extension/test/beforeunload-suppress.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractSuppressor(src) {
  const marker = 'const suppressBeforeUnload = '
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('suppressBeforeUnload not found — op:nav must neutralize beforeunload via a named `const suppressBeforeUnload = () => {…}` before navigating an existing tab')
  const bodyStart = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break } } }
  return src.slice(src.indexOf('()', start), i)
}

const src = (() => { try { return extractSuppressor(BG) } catch { return null } })()

console.log('\n  -- op:nav neutralizes beforeunload before navigating an existing tab --\n')

test('suppressBeforeUnload exists as a named injected fn', () => assert(src, 'background.js must define `const suppressBeforeUnload = () => {…}`'))

test('nav handler calls neutralize before the same-origin tabs.update', () => {
  // structural backstop: the suppressor must actually be wired into the nav path
  const navStart = BG.indexOf("case 'nav': {")
  const navRegion = BG.slice(navStart, navStart + 4000)
  const updIdx = navRegion.indexOf('chrome.tabs.update(tabId, { url: params.url })')
  assert(updIdx !== -1, 'same-origin tabs.update line present')
  const neutIdx = navRegion.indexOf('neutralizeBeforeUnload(')
  assert(neutIdx !== -1 && neutIdx < updIdx, 'neutralizeBeforeUnload(tabId) must run BEFORE the same-origin tabs.update')
})

test('suppressor nulls onbeforeunload AND adds a capturing listener that suppresses the dialog', () => {
  assert(src, 'suppressor missing')
  const listeners = []
  const fakeWindow = {
    onbeforeunload: function pageGuard() { },
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }) },
  }
  new Function('window', `(${src})()`)(fakeWindow)
  assert.equal(fakeWindow.onbeforeunload, null, 'must null window.onbeforeunload')
  const bu = listeners.filter(l => l.type === 'beforeunload')
  assert(bu.length >= 1, 'must register a beforeunload listener (covers addEventListener-based page guards)')
  const cap = bu.find(l => l.opts === true || (l.opts && l.opts.capture === true))
  assert(cap, 'beforeunload listener must be capturing (runs before the page handler)')
  // invoke it with a returnValue-setting event; assert the dialog trigger is neutralized
  let stopped = false, prevented = false
  const ev = { returnValue: 'You have unsaved changes', preventDefault() { prevented = true }, stopImmediatePropagation() { stopped = true } }
  cap.fn(ev)
  assert(stopped, 'must stopImmediatePropagation so the page beforeunload handler never runs')
  assert(!ev.returnValue, `must clear returnValue (non-empty returnValue is what fires the dialog), got ${JSON.stringify(ev.returnValue)}`)
  // Adversarial: calling preventDefault() on beforeunload REQUESTS the dialog
  // (HTML spec) — the suppressor must NOT call it, or it pops the very dialog it
  // exists to kill (2026-06-12 dogfood: dirty reload hung ~3.5min on exactly this).
  assert(!prevented, 'suppressor must NOT call preventDefault() — that REQUESTS the beforeunload dialog')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
