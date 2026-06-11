/**
 * Constraint: native JS dialogs (alert/confirm/prompt/beforeunload) are
 * auto-handled at the CDP layer so they can never hang an op.
 * Classification: safety / what — 2026-06-11 weixin dogfood: a native "Leave
 *   site?" dialog hung op:nav ~3.5min until the relay socket timed out. Native
 *   dialogs are NOT page DOM — no op can dismiss them. P0b suppresses the
 *   beforeunload on the nav path via page injection; this is the GENERAL defense
 *   for the whole dialog class on any debugger-attached op (a confirm()/alert()
 *   fired mid-op would otherwise still hang with no page-side suppressor).
 *
 * Policy (safe-by-default): ACCEPT beforeunload (we navigate on purpose → leave)
 * and alert (informational, nothing to confirm); DISMISS confirm + prompt
 * (cancel — NEVER auto-confirm a destructive "确定删除?" the agent didn't intend).
 *
 * Behavioral (extract-and-run): the named handler `async function
 * handleDialogEvent` is pulled from background.js and executed against a
 * chrome.debugger.sendCommand spy.
 *
 * Phase 1a (adversarial): a half-impl that accepts ALL dialogs (or dismisses all)
 * passes a grep for handleJavaScriptDialog but is unsafe/wrong. This RUNS each
 * dialog type and asserts the per-type accept flag — accept-all fails the
 * confirm/prompt cases, dismiss-all fails beforeunload/alert.
 *
 * Run: node extension/test/dialog-autohandle.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractAsyncFn(src, name) {
  const marker = `async function ${name}(`
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker}…) not found`)
  const bodyStart = src.indexOf('{', start)
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break } } }
  return src.slice(start, i)
}

const fnSrc = (() => { try { return extractAsyncFn(BG, 'handleDialogEvent') } catch { return null } })()

function buildHandler() {
  const calls = []
  const chrome = { debugger: { sendCommand: async (target, method, params) => { calls.push({ target, method, params }); return {} } } }
  const handler = new Function('chrome', `${fnSrc}\nreturn handleDialogEvent`)(chrome)
  return { handler, calls }
}

console.log('\n  -- native dialogs auto-handled at CDP layer (never hang an op) --\n')

test('handleDialogEvent exists as a named handler', () =>
  assert(fnSrc, 'background.js must define `async function handleDialogEvent(source, method, params)`'))

// NOTE: handleDialogEvent is async, but it invokes chrome.debugger.sendCommand
// SYNCHRONOUSLY (the call expression runs before `await` suspends), so `calls`
// is populated before handler(...) returns its promise — assert synchronously.
test('ignores non-dialog events (no handleJavaScriptDialog call)', () => {
  assert(fnSrc, 'handler missing')
  const { handler, calls } = buildHandler()
  handler({ tabId: 1 }, 'Network.requestWillBeSent', {})
  assert.equal(calls.length, 0, 'must not act on non-dialog CDP events')
})

for (const [type, accept] of [['beforeunload', true], ['alert', true], ['confirm', false], ['prompt', false]]) {
  test(`${type} → handleJavaScriptDialog accept:${accept}`, () => {
    assert(fnSrc, 'handler missing')
    const { handler, calls } = buildHandler()
    handler({ tabId: 7 }, 'Page.javascriptDialogOpening', { type })
    assert.equal(calls.length, 1, 'must handle the dialog exactly once')
    assert.equal(calls[0].method, 'Page.handleJavaScriptDialog')
    assert.equal(calls[0].target.tabId, 7, 'must target the source tab')
    assert.equal(calls[0].params.accept, accept, `${type} accept policy`)
  })
}

test('handler is registered AND Page is enabled on debugger attach (wiring)', () => {
  assert(BG.includes('chrome.debugger.onEvent.addListener(handleDialogEvent)'),
    'handleDialogEvent must be registered as a debugger event listener')
  const ed = BG.slice(BG.indexOf('async function ensureDebugger('), BG.indexOf('async function withDebugger('))
  assert(ed.includes("'Page.enable'"),
    'ensureDebugger must enable the Page domain so Page.javascriptDialogOpening is delivered')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
