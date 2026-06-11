/**
 * Constraint: op:input keytype verifies the typed text landed in a CONTENTEDITABLE
 * by reading innerText/textContent — not `.value` (which is undefined on a
 * contenteditable <div>, yielding a false "value did not land" error).
 * Classification: correctness / what — 2026-06-11 weixin dogfood: keytype into a
 *   contenteditable threw `keytype: value did not land (got len 0)` even though
 *   Input.insertText placed the text (text was in .innerText, verifier read .value).
 *
 * Behavioral (extract-and-run, like visible-click.test.mjs): the keytype
 * post-verify read is extracted from background.js source and executed against a
 * DOM double whose element is contenteditable (isContentEditable:true,
 * innerText set, value:undefined).
 *
 * Phase 1a (adversarial): a half-impl that keeps `el.value || ''` passes any
 * grep mentioning innerText elsewhere. This RUNS the verifier read against a
 * contenteditable double and asserts it returns the text — the `.value`-only
 * impl returns '' and fails. And asserts a plain <input> still reads `.value`
 * (no regression to the rc-field-form case keytype exists for).
 *
 * Run: node extension/test/keytype-verify.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0
const test = (n, f) => { try { f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${n}\n    ${e.message}`) } }

// Extract `const readControlValue = (s) => { ... }` (GREEN names the keytype verifier read).
function extractReader(src) {
  const marker = 'const readControlValue = '
  const start = src.indexOf(marker)
  if (start === -1) throw new Error('readControlValue not found — keytype must name its verify-read `const readControlValue = (s) => {…}`')
  const bodyStart = src.indexOf('{', src.indexOf('=>', start))
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break } } }
  return src.slice(src.indexOf('(s)', start), i)
}

const readerSrc = (() => { try { return extractReader(BG) } catch { return null } })()

console.log('\n  -- keytype verify-read is contenteditable-aware --\n')

test('readControlValue exists as a named injected fn', () => assert(readerSrc, 'keytype must define `const readControlValue = (s) => {…}`'))

test('contenteditable (value:undefined, innerText set) → reads innerText', () => {
  assert(readerSrc, 'reader missing')
  const ce = { isContentEditable: true, value: undefined, innerText: '你好世界', textContent: '你好世界' }
  const doc = { querySelector: () => ce }
  const fn = new Function('document', `return (${readerSrc})`)(doc)
  const got = fn('.edit_area')
  assert.equal((got || '').replace(/\s+/g, ''), '你好世界', `contenteditable read must return its text, got ${JSON.stringify(got)}`)
})

test('plain <input> still reads .value (no regression)', () => {
  assert(readerSrc, 'reader missing')
  const inp = { isContentEditable: false, value: 'abc123', innerText: '', textContent: '' }
  const fn = new Function('document', `return (${readerSrc})`)({ querySelector: () => inp })
  assert.equal(fn('#x'), 'abc123', 'plain input must still read .value')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
