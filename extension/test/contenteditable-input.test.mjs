/**
 * Constraint: op:input type/fill/press work on contenteditable rich-text
 *             editors (Quill / ProseMirror) and surface failure on no-effect.
 * Classification: correctness / what — issue #19: type/press/fill were silent
 *                 no-ops on Quill `.ql-editor`. fill/type used the
 *                 HTMLInputElement.prototype value-setter (no .value on a
 *                 contenteditable <div>); the per-char Input.dispatchKeyEvent
 *                 fallback left the editor model untouched yet returned
 *                 success, so downstream submit validation silently failed.
 *
 * Fix invariants (background.js):
 *   1. A dedicated contenteditable path uses CDP `Input.insertText` (drives the
 *      beforeinput/input pipeline Quill observes) — NOT per-char dispatchKeyEvent.
 *   2. `type` and `fill` detect `isContentEditable` and route to that path.
 *   3. The contenteditable path VERIFIES the mutation landed and THROWS
 *      (`input_ineffective`) when it didn't — no more silent success.
 *   4. Inner keyboard sub-calls propagate `tabId` (type's key path + pressKey),
 *      so keystrokes hit the dispatch-target tab, not the active tab.
 *   5. Non-contenteditable key-listener widgets keep the legacy key-event path.
 *
 * Source-introspection style (matches multi-tab / kernel-behavior tests):
 * background.js drives chrome.* + CDP and can't run headless, so we assert the
 * structural contract over its source.
 *
 * Run: node extension/test/contenteditable-input.test.mjs
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

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

function slice(marker, len) {
  const i = BG_SRC.indexOf(marker)
  assert(i !== -1, `marker not found in background.js: ${marker}`)
  return BG_SRC.substring(i, i + len)
}

// Brace-match the whole {...} block after `marker` — robust to the block gaining
// helpers. (A fixed-length slice silently truncated when TAP_DEEP_INSTALL grew a
// `deep` fallback helper, hiding `control` from the assertions below — the exact
// magic-length fragility shadow-piercing.test.mjs already moved away from.)
function blockAfter(marker) {
  const start = BG_SRC.indexOf(marker)
  assert(start !== -1, `marker not found in background.js: ${marker}`)
  const braceStart = BG_SRC.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces after: ${marker}`)
}

// ── Rule 1: contenteditable helper uses Input.insertText + verifies ──
console.log('\n  -- Rule 1: trusted contenteditable insertion --\n')

const helperStart = BG_SRC.indexOf('async function typeIntoContentEditable(')
test('typeIntoContentEditable helper exists', () => {
  assert(helperStart !== -1,
    'a dedicated contenteditable insertion helper must exist')
})

{
  const helper = BG_SRC.substring(helperStart, helperStart + 3200) // widened for the RC1 IME-composition pipeline + clear-selection (2026-06-12)

  test('helper uses CDP Input.insertText (not per-char dispatchKeyEvent)', () => {
    assert(helper.includes("'Input.insertText'") || helper.includes('"Input.insertText"'),
      'contenteditable path must drive CDP Input.insertText to match human typing')
  })

  test('helper establishes focus/caret via a real CDP click', () => {
    assert(/cdpClick\(\s*tabId/.test(helper),
      'helper must cdpClick to place a caret — el.focus() alone leaves no selection for insertText')
  })

  test('helper verifies the mutation took effect', () => {
    assert(helper.includes('textContent'),
      'helper must re-read editor text to confirm the insertion landed')
  })

  test('helper THROWS input_ineffective on no-effect (no silent success)', () => {
    assert(/throw new Error\(/.test(helper) && helper.includes('input_ineffective'),
      'helper must throw (not return success) when the editor rejected the keystrokes')
  })

  test('helper propagates tabId to its select-all keyboard sub-call', () => {
    assert(/handleMethod\('keyboard',\s*\{\s*tabId/.test(helper),
      "helper's keyboard sub-call must pass tabId so it targets the right tab")
  })
}

// ── Rule 2: type/fill route contenteditable to the helper ──
console.log('\n  -- Rule 2: type/fill detect contenteditable --\n')

{
  const typeBody = slice("case 'type': {", 3000)
  test('type detects el.isContentEditable', () => {
    assert(typeBody.includes('isContentEditable'),
      'type must branch on isContentEditable to pick the trusted-keystroke path')
  })
  test('type routes contenteditable to typeIntoContentEditable', () => {
    assert(typeBody.includes('typeIntoContentEditable'),
      'type must delegate contenteditable targets to the insertText helper')
  })
  test('type keeps a legacy key-event path for non-editable widgets', () => {
    // The "keys" branch preserves dispatchKeyEvent-style typing for widgets
    // that only LISTEN to key events (insertText would not fire their handlers).
    assert(/mode\s*===\s*'keys'/.test(typeBody) && /action:\s*'type'/.test(typeBody),
      'type must retain the per-char keyboard path for non-contenteditable widgets')
  })
  test('type key-path keyboard sub-calls propagate tabId', () => {
    const keysIdx = typeBody.indexOf("probe.mode === 'keys'")
    const keysBranch = typeBody.substring(keysIdx, keysIdx + 400)
    const calls = keysBranch.match(/handleMethod\('keyboard',\s*\{[^}]*\}/g) || []
    assert(calls.length >= 2 && calls.every(c => c.includes('tabId')),
      'both keyboard sub-calls in the keys branch must pass tabId')
  })
}

{
  // Slice sized to the fill handler. Widened 2098 -> 2400 (2026-07-08) when the
  // TargetResolver branch (resolver-aware element pick) grew the case; the
  // contenteditable-delegation invariant below is unchanged.
  const fillBody = slice("case 'fill': {", 2400)
  test('fill detects el.isContentEditable', () => {
    assert(fillBody.includes('isContentEditable'),
      'fill must branch on isContentEditable instead of the no-op value setter')
  })
  test('fill routes contenteditable to typeIntoContentEditable', () => {
    assert(fillBody.includes('typeIntoContentEditable'),
      'fill must delegate contenteditable targets to the insertText helper')
  })
}

// ── Rule 4 (#61): type & fill write masked / web-component inner inputs ──
// Masked inputs (air3 currency, Reddit faceplate-text-input) put the writable
// <input> inside the custom element's shadow root; .value on the host is inert.
// Both kinds must resolve the inner control by piercing (nested) open shadow
// roots, or the write is a silent no-op on the host.
console.log('\n  -- Rule 4: masked / web-component inner-input resolution --\n')

{
  const typeBody = slice("case 'type': {", 3000)
  const fillBody = slice("case 'fill': {", 2400)
  // The inner-control resolver (formerly inline `deepControl` ×3) now lives ONCE
  // in TAP_DEEP_INSTALL as __tapDeep.control. The #61 invariant is unchanged — it
  // just moved: assert it at its new home AND that the handlers wire to it.
  const installBody = blockAfter('const TAP_DEEP_INSTALL =')

  test('type/fill resolve the inner form control via shared __tapDeep.control', () => {
    assert(typeBody.includes('__tapDeep.control('),
      'type must resolve the inner control via __tapDeep.control, not branch solely on el.tagName === INPUT')
    assert(fillBody.includes('__tapDeep.control('),
      'fill must resolve the inner control via the same shared resolver')
  })

  test('__tapDeep.control pierces nested open shadow roots with a bounded depth', () => {
    assert(/shadowRoot/.test(installBody) && /querySelectorAll/.test(installBody),
      'control must descend into element.shadowRoot (and nested hosts) to find the inner control')
    assert(/control\(h, d \+ 1\)/.test(installBody) && /d > \d/.test(installBody),
      'control must recurse into nested shadow roots with a depth guard (avoid infinite walks)')
  })

  test('inner-control write swallows masked-input handler throws (#60)', () => {
    // air3 currency throws "null (reading 'mode')" in its input handler AFTER the
    // value is already set; the dispatch must not propagate that as a write failure.
    assert(/catch \(_\) \{ \/\* value persisted \*\/ \}/.test(typeBody),
      "type's inner-control write must swallow the post-set handler throw (#60)")
  })
}

// ── Rule 3: pressKey propagates tabId ──
console.log('\n  -- Rule 3: pressKey targets the right tab --\n')

{
  const pressBody = slice("case 'pressKey':", 300)
  test('pressKey forwards tabId to the keyboard handler', () => {
    assert(/handleMethod\('keyboard',\s*\{\s*tabId/.test(pressBody),
      'pressKey must pass tabId so the keystroke hits the dispatch-target tab')
  })
}

// --- Summary ---
console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
