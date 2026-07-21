/**
 * Constraint: the Chrome-capability peer methods + UX surfaces are wired
 * (ADR 2026-07-08-op-capabilities). [safety/what]
 *
 * These are BROWSER-LIVE features — their runtime behavior (a PDF actually
 * printed, an overlay actually drawn, a screencast actually streamed, the side
 * panel actually rendering) is only verifiable against a real Chrome. This
 * suite is a deletion-proof STRUCTURAL guard on the wiring, NOT a behavior
 * test; it prevents the surface from silently regressing/being removed. Live
 * verification is a manual/dogfood pass.
 *
 * Run: node extension/test/chrome-capabilities.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
const MANIFEST = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf-8'))
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}`); console.log(`    ${e.message}`) }
}

test('op:pdf method uses CDP Page.printToPDF and returns a pdf mime', () => {
  assert(BG.includes("case 'pdf'"), 'pdf handler must exist (op:pdf → method pdf)')
  assert(BG.includes('Page.printToPDF'), 'must call CDP Page.printToPDF')
  assert(BG.includes("mime: 'application/pdf'"), 'must tag the artifact as PDF')
})

test('op:pdf stamp mode overlays via bundled offline pdf-lib (not chrome://pdf CDP)', () => {
  // ADR 2026-07-15: stamp is mechanical/tab-free; done by a pinned, offline
  // pdf-lib, NOT by driving the in-viewer annotation UI (content-script-inaccessible,
  // no CDP annotation command). Guards the spike-proven mechanism from silently
  // regressing to a chrome://pdf dependency.
  assert(BG.includes("mode === 'stamp'"), 'pdf handler must branch on stamp mode')
  assert(BG.includes("import('./lib/pdf-lib.esm.js')"), 'stamp must use the vendored OFFLINE pdf-lib (local ./lib path)')
  assert(BG.includes('embedPng'), 'stamp must embed the signature PNG')
  assert(BG.includes('drawImage'), 'stamp must draw the overlay at (x,y)')
  assert(BG.includes('bytesToB64'), 'stamp must return base64 PDF bytes (same {data,mime} shape as export)')
})

// highlight / screencast / point handler tests were removed with the ops —
// retired by ADR 2026-07-13-op-union-minimization (no plan op can reach them).
// Their DELETION from background.js is now guarded by op-handler-drift.test.mjs.

test('focusEmulate method re-arms focus/lifecycle emulation on demand', () => {
  assert(BG.includes("case 'focusEmulate'"), 'focusEmulate handler must exist')
  assert(BG.includes('enableFocusEmulation('), 'must reuse the shared focus-emulation helper')
})

test('op:notify pushes a message to the side panel storage key', () => {
  assert(BG.includes("case 'notify'"), 'notify handler must exist (op:notify)')
  assert(BG.includes("'tap:notify'"), 'must write the tap:notify storage key the side panel reads')
})

test('context-menu element picker emits a resolver to storage', () => {
  assert(BG.includes("id: 'tap-pick'"), 'pick menu must be registered')
  assert(BG.includes("'tap:lastPickedResolver'"), 'picker must persist a resolver for the host/agent')
  assert(BG.includes('D.implicitRole') || BG.includes('implicitRole('),
    'picked resolver must include the role so it matches pick() at replay')
})

test('background-tab presence shim spoofs visibilityState at document-start', () => {
  // Focus emulation cannot change document.visibilityState — a background tab
  // still reports 'hidden', blocking Page-Visibility-gated flows (小红书 publish).
  // The shim must (1) define visibilityState=visible, (2) install at document-start
  // via addScriptToEvaluateOnNewDocument (survives SPA navs, not a per-op race),
  // and (3) also apply to the already-loaded doc via Runtime.evaluate.
  assert(BG.includes('PRESENCE_SHIM_SRC'), 'presence shim source constant must exist')
  assert(BG.includes("'visibilityState', 'visible'"), 'must spoof document.visibilityState → visible')
  assert(BG.includes('Page.addScriptToEvaluateOnNewDocument'),
    'must install at document-start (survives navigation), not per-op')
  assert(/installPresenceShim/.test(BG) && /enableFocusEmulation[\s\S]*installPresenceShim/.test(BG),
    'presence shim must be wired into the attach-time focus-emulation path')
})

test('context menu stays minimal (agent-first): only pick + panel, no menu creep', () => {
  // 2026-07-08 re-analysis: the human menu is a fallback, not the main path — the
  // agent self-targets from the affordance map + op:point. Guard against menu
  // creep: exactly the two authoring-time items, nothing more.
  const ids = [...BG.matchAll(/contextMenus\.create\(\s*\{\s*id:\s*'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(new Set(ids), new Set(['tap-pick', 'tap-panel']),
    `menu must be exactly {tap-pick, tap-panel}, got: ${ids.join(', ')}`)
})

test('bridge status has a producer: setBadge mirrors tap:bridgeConnected (false-negative fix)', () => {
  // 2026-07-08 bug: the panel read tap:bridgeConnected from storage but NOTHING
  // wrote it, so the bridge dot permanently showed "bridge not running" even
  // while connected + running runs (the picker still worked because it's
  // bridge-independent). Fix: setBadge — the single connect/throw/disconnect
  // chokepoint that owns `connected` — mirrors it into storage, so panel ==
  // badge == popup. (tap:currentRun / tap:recentRuns are the same *class* but a
  // whole-plan run is not SW-observable — the host runs the plan, the SW only
  // sees per-op calls — so those need a host→SW push and are deferred, tracked
  // by the placeholder-honesty assertion below.)
  assert(/function setBadge[\s\S]*?tap:bridgeConnected/.test(BG),
    'setBadge must mirror tap:bridgeConnected into storage for the panel')
  const SP = readFileSync(new URL('../sidepanel.js', import.meta.url), 'utf-8')
  assert(SP.includes("'tap:bridgeConnected'"), 'panel must read tap:bridgeConnected')
})

test('side panel is declared + files present', () => {
  assert(MANIFEST.side_panel && MANIFEST.side_panel.default_path === 'sidepanel.html',
    'manifest must declare side_panel.default_path')
  assert(existsSync(new URL('../sidepanel.html', import.meta.url)), 'sidepanel.html must exist')
  assert(existsSync(new URL('../sidepanel.js', import.meta.url)), 'sidepanel.js must exist')
  assert(BG.includes('chrome.sidePanel'), 'background must wire the side panel open path')
})

test('manifest grants the permissions the capabilities need (and NOT the deleted keepalive ones)', () => {
  const p = new Set(MANIFEST.permissions)
  for (const need of ['contextMenus', 'sidePanel']) {
    assert(p.has(need), `manifest.permissions must include ${need}`)
  }
  // `downloads` was declared speculatively in the 2026-07-08 capabilities
  // commit but chrome.downloads is consumed NOWHERE — op:pdf/screencast
  // return base64 over native messaging, no browser-download path. An
  // unused permission is a CWS review liability (removed 2026-07-11);
  // re-adding it requires an actual chrome.downloads consumer in the
  // same commit.
  assert(!p.has('downloads'),
    'must NOT declare unused downloads permission (no chrome.downloads consumer)')
  // SW keepalive was deleted (ADR 2026-05-13) — the NM port keeps the SW alive.
  // Re-adding alarms/offscreen would revert that deliberate decision.
  assert(!p.has('alarms') && !p.has('offscreen'),
    'must NOT re-add alarms/offscreen keepalive (deleted per ADR 2026-05-13)')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
