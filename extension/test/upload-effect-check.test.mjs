/**
 * Constraint: op:input kind:upload must FAIL LOUD on a silent no-op.
 * Classification: safety / honest-outcome -- violations return {} (ok) when the
 * input actually holds zero files, so a missed upload reads as success.
 *
 * Background: setFileInputFiles can resolve while the target input ends up
 * empty -- a path that doesn't exist / isn't readable, or a directory handed to
 * a non-webkitdirectory input. The empty-`value` guard (normalizeUploadFiles)
 * only covers the case where the CALLER passed no files; it cannot catch the
 * case where files WERE passed but none landed. Both the top-document and the
 * frame-piercing branches must therefore read the post-set file count and throw
 * when it is zero, rather than returning {}.
 *
 * Ordering is load-bearing: the count must be captured BEFORE the input+change
 * re-dispatch, because a React-synthetic onChange (Ant/rc-upload, Next.js
 * dropzones) consumes/detaches el.files -- a post-dispatch read false-reads 0 on
 * SUCCESS and would regress every working synthetic-component upload.
 *
 * These are source-slice constraints (same style as frame-piercing.test.mjs):
 * they anchor the guard in background.js so a refactor can't quietly drop it.
 *
 * Run: node extension/test/upload-effect-check.test.mjs
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

function uploadCase() {
  const i = BG_SRC.indexOf("case 'upload': {")
  assert(i >= 0, "upload case not found")
  // window covers the whole upload case (trusted chooser-intercept +
  // frame-piercing + top-document); the case runs ~8.7k chars to the next case.
  return BG_SRC.slice(i, i + 8800)
}

console.log('\nupload effect-check (no silent upload miss)\n')

test('empty-value guard still fails loud (regression floor)', () => {
  // The pre-existing floor: caller passed no files at all.
  assert(BG_SRC.includes('upload: no files'),
    'normalizeUploadFiles must still throw when value carries zero paths')
})

test('both DOM-selector branches throw when the input holds 0 files after set', () => {
  const body = uploadCase()
  const hits = body.split('upload: input holds 0 files after setFileInputFiles').length - 1
  assert(hits >= 2,
    `expected the zero-file fail-loud in BOTH the top-document and frame-piercing branches, found ${hits}`)
})

test('the zero-file check reads el.files.length (not a bare truthiness of the node)', () => {
  const body = uploadCase()
  assert(body.includes('el.files ? el.files.length : 0'),
    'must read the actual file count, so a resolved-but-empty input is caught')
})

test('count is captured BEFORE change re-dispatch (else synthetic onChange false-reads 0)', () => {
  const body = uploadCase()
  // In each verify+dispatch expression, `const n = el.files...` must precede the
  // `change` dispatch. Check every occurrence, not just the first.
  let from = 0
  let checked = 0
  for (;;) {
    const nIdx = body.indexOf('const n = el.files', from)
    if (nIdx < 0) break
    const changeIdx = body.indexOf("new Event('change'", nIdx)
    assert(changeIdx > nIdx,
      'files.length must be read before the change event is dispatched in the same page-context pass')
    checked++
    from = changeIdx
  }
  assert(checked >= 2, `expected the ordered read+dispatch in both branches, found ${checked}`)
})

test('a resolved-but-vanished node also fails loud (found !== true)', () => {
  const body = uploadCase()
  assert(body.includes('file input vanished after setFileInputFiles'),
    'if the selector no longer resolves after set, throw rather than return {}')
})

console.log(`\n${passed + failed} constraints, ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
