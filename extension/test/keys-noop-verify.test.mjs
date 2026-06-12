/**
 * Constraint: op:input type's `keys` fallback (per-char CDP dispatchKeyEvent)
 * MUST verify the text landed when the target is an editor context — a silent
 * no-op there is a failure, not a success.
 * Classification: correctness+safety / what — 2026-06-11 weixin dogfood: typing
 *   into `.emotion_editor` (被关注回复 composer — a non-isContentEditable host)
 *   fell into the `keys` path; per-char dispatchKeyEvent({text}) no-op'd (issue
 *   #19's lesson) and, UNLIKE the contenteditable path, the keys path had no
 *   post-verify — so it returned success with zero text landed. Cost: 6 attempts
 *   chasing a silent no-op that should have surfaced as one input_ineffective.
 *
 * Behavioral (extract-and-run, like visible-click / keytype-verify): the keys
 * path's landed-check is pulled from background.js source as a named injected fn
 * `const keysLanded = (s, want) => {…}` and executed against DOM doubles.
 *
 * Phase 1a (adversarial): a half-impl that just greps innerText, or that throws
 * UNCONDITIONALLY on the keys path, fails here. The gate is the point: it must
 * report editorish=true,has=false for the .emotion_editor shape (→ handler
 * throws) but NOT false-fail a pure key-LISTENER widget (no contenteditable
 * anywhere — the reason the keys path exists). This RUNS both shapes.
 *
 * Phase 1b (anchor): the real shape is a div host (isContentEditable=false) whose
 * editable lives in/near a [contenteditable] descendant, innerText empty after a
 * no-op type — the weixin .emotion_editor captured 2026-06-11.
 *
 * Run: node extension/test/keys-noop-verify.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

function extractFn(src, marker, argsig) {
  const start = src.indexOf(marker)
  if (start === -1) throw new Error(`${marker.trim()} not found`)
  const bodyStart = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break } } }
  return src.slice(src.indexOf(argsig, start), i)
}

const fnSrc = (() => { try { return extractFn(BG, 'const keysLanded = ', '(s,') } catch { return null } })()

const run = (src, doc) => new Function('document', `return (${src})`)(doc)
const docWith = (el) => ({ querySelector: () => el })

console.log('\n  -- op:input type keys-path verifies it landed (editor-gated) --\n')

test('keysLanded exists as a named injected fn', () =>
  assert(fnSrc, 'type keys-path must define `const keysLanded = (s, want) => {…}` (named so it injects AND is testable)'))

test('editor host (contenteditable descendant), text did NOT land → editorish:true, has:false (handler must throw)', () => {
  assert(fnSrc, 'keysLanded missing')
  const editorHost = {
    isContentEditable: false,
    innerText: '', textContent: '',
    querySelector: (q) => (/contenteditable/.test(q) ? { tag: 'DIV' } : null),
    closest: () => null,
  }
  const r = run(fnSrc, docWith(editorHost))('.emotion_editor', '欢迎关注')
  assert.equal(r.found, true)
  assert.equal(r.editorish, true, 'a host with a [contenteditable] descendant is an editor context')
  assert.equal(r.has, false, 'empty editor after a no-op type must report has:false')
})

test('editor host, text DID land → has:true (no throw)', () => {
  assert(fnSrc, 'keysLanded missing')
  const editorHost = {
    isContentEditable: false,
    innerText: '欢迎关注 这个号做核查报告', textContent: '欢迎关注 这个号做核查报告',
    querySelector: (q) => (/contenteditable/.test(q) ? { tag: 'DIV' } : null),
    closest: () => null,
  }
  const r = run(fnSrc, docWith(editorHost))('.emotion_editor', '欢迎关注')
  assert.equal(r.has, true, 'landed text (whitespace-insensitive) must report has:true')
})

test('pure key-LISTENER widget (no contenteditable anywhere) → editorish:false (NEVER false-fails)', () => {
  assert(fnSrc, 'keysLanded missing')
  const listener = { isContentEditable: false, innerText: '', textContent: '', querySelector: () => null, closest: () => null }
  const r = run(fnSrc, docWith(listener))('.hotkey-capture', 'abc')
  assert.equal(r.editorish, false, 'no contenteditable in/around it → not an editor → keys path stays silent (no regression)')
})

test('handler throws input_ineffective when found && editorish && !has (wiring)', () => {
  const i = BG.indexOf("} else if (probe.mode === 'keys') {")
  assert(i !== -1, "keys branch present")
  const branch = BG.slice(i, i + 2200) // window covers the comment + keysLanded fn + throw
  assert(branch.includes('keysLanded'), 'keys branch must call keysLanded after typing')
  assert(branch.includes('editorish') && branch.includes('input_ineffective'),
    'keys branch must throw input_ineffective when an editor-context type landed nothing')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
