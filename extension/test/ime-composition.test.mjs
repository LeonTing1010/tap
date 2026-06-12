/**
 * Constraint: op:input type/fill into a contenteditable drives the TRUSTED IME
 * composition pipeline (Input.imeSetComposition → Input.insertText), not a bare
 * insertText — so editors that commit their MODEL only on composition events
 * (compositionstart/update/end), as Chinese IME rich editors do, actually sync.
 * Classification: correctness / what — RC1, 2026-06-12 weixin dogfood: WeChat
 *   msg-sender `.edit_area` kept an EMPTY model (确定 → "内容不能为空") even though
 *   insertText filled the DOM; op:input press (dispatchKeyEvent) no-op'd, blur
 *   didn't sync, and op:eval event-dispatch is lint-forbidden — leaving NO path
 *   to commit the editor's model. imeSetComposition produces the trusted
 *   compositionstart/update; the following insertText commits (compositionend +
 *   input). insertText stays the commit step → Quill/ProseMirror unaffected.
 *
 * Behavioral (extract-and-run): typeIntoContentEditable is pulled from
 * background.js source and executed with stubbed deps that RECORD the CDP command
 * order, so we assert the real call sequence — not a grep.
 *
 * Phase 1a (adversarial): a half-impl that greps "imeSetComposition" into a
 * comment, or calls it AFTER insertText, fails — this checks the recorded order
 * (compose THEN commit) and the params (full text, caret at end).
 *
 * Run: node extension/test/ime-composition.test.mjs
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const BG = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')
let passed = 0, failed = 0

function extractAsyncFn(src, name) {
  const marker = `async function ${name}(`
  const start = src.indexOf(marker)
  if (start === -1) return null
  const bodyStart = src.indexOf('{', start)
  let depth = 0, i = bodyStart
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { i++; break } } }
  return src.slice(start, i)
}

const fnSrc = extractAsyncFn(BG, 'typeIntoContentEditable')

async function runType(text) {
  const cmds = []
  const chrome = { debugger: { sendCommand: async (_t, method, params) => { cmds.push({ method, params }); return {} } } }
  const cdpClick = async () => { cmds.push({ method: 'cdpClick' }) }
  const handleMethod = async () => { cmds.push({ method: 'selectAll' }) }
  const withDebugger = async (_tabId, f) => await f()
  const execFunc = async () => text // verify-read returns the text → DOM check passes
  const factory = new Function('cdpClick', 'handleMethod', 'withDebugger', 'chrome', 'execFunc',
    `${fnSrc}\nreturn typeIntoContentEditable`)
  const fn = factory(cdpClick, handleMethod, withDebugger, chrome, execFunc)
  await fn(1, null, '.edit_area', text, { x: 10, y: 10 })
  return cmds
}

async function test(name, f) {
  try { await f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`) }
}

async function main() {
  console.log('\n  -- RC1: contenteditable typing drives the trusted IME composition pipeline --\n')

  await test('typeIntoContentEditable exists', () => assert(fnSrc, 'helper must exist'))

  await test('non-empty text: imeSetComposition fires BEFORE insertText (compose → commit)', async () => {
    const cmds = await runType('你好世界')
    const ime = cmds.findIndex(c => c.method === 'Input.imeSetComposition')
    const ins = cmds.findIndex(c => c.method === 'Input.insertText')
    assert(ime !== -1, 'must call Input.imeSetComposition (fires compositionstart/update the model listens for)')
    assert(ins !== -1, 'must still call Input.insertText (commit: compositionend + input)')
    assert(ime < ins, 'imeSetComposition must PRECEDE insertText (compose, then commit)')
  })

  await test('imeSetComposition carries the full text with caret collapsed at end', async () => {
    const cmds = await runType('你好世界')
    const ime = cmds.find(c => c.method === 'Input.imeSetComposition')
    assert.equal(ime.params.text, '你好世界', 'composition text must be the full string')
    assert.equal(ime.params.selectionStart, 4, 'selectionStart at end')
    assert.equal(ime.params.selectionEnd, 4, 'selectionEnd at end (collapsed caret)')
  })

  await test('insertText still commits the same text (composition-agnostic editors unaffected)', async () => {
    const cmds = await runType('abc')
    const ins = cmds.find(c => c.method === 'Input.insertText')
    assert.equal(ins.params.text, 'abc')
  })

  await test('empty text: skips composition (no imeSetComposition on a clear)', async () => {
    const cmds = await runType('')
    assert(!cmds.some(c => c.method === 'Input.imeSetComposition'), 'empty insert must not open a composition')
  })

  await test('select-all precedes composition (replaces existing content)', async () => {
    const cmds = await runType('xy')
    const sel = cmds.findIndex(c => c.method === 'selectAll')
    const ime = cmds.findIndex(c => c.method === 'Input.imeSetComposition')
    assert(sel !== -1 && sel < ime, 'select-all must run before composition so it replaces existing content')
  })

  console.log(`\n  ${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}
main()
