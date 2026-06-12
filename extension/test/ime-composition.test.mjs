/**
 * Constraint: op:input type/fill into a contenteditable is EDITOR-AWARE.
 *  - Custom editors that commit their MODEL only on compositionend (WeChat
 *    msg-sender `.edit_area`) get the trusted IME pipeline: select-all →
 *    insertText('') [clear] → imeSetComposition (compositionstart/update) →
 *    insertText (commit: compositionend + input).
 *  - Editors that handle Input.insertText natively (ProseMirror, Quill — issue
 *    #19 — CodeMirror) DOUBLE-insert under a composition, so they get plain
 *    select-all → insertText (single replace), NO composition.
 * Classification: correctness / what — RC1 (2026-06-12 weixin dogfood). The
 *   composition fix made `.edit_area` writable (counter 300→226) but doubled
 *   ProseMirror (被关注: pmLen 197 ≈ 2×) — so composition must be opt-in for
 *   editors not recognised as native-insert.
 *
 * Behavioral (extract-and-run): typeIntoContentEditable is pulled from
 * background.js and executed with stubbed deps + a fake execFunc that runs the
 * injected page-functions (the native-editor probe + the verify read) against a
 * fake editor element, so we assert the real CDP command sequence per editor kind.
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

// Fake editor element supporting the probe (closest/classList) + verify (textContent).
function makeEditorEl(kind, text) {
  if (kind === 'prosemirror') {
    return {
      closest: (s) => /ProseMirror|ql-editor|CodeMirror|cm-editor/.test(s) ? {} : null,
      classList: { contains: (c) => c === 'ProseMirror' },
      textContent: text,
    }
  }
  return { closest: () => null, classList: { contains: () => false }, textContent: text } // custom contenteditable
}

async function runType(text, kind = 'custom') {
  const cmds = []
  const chrome = { debugger: { sendCommand: async (_t, method, params) => { cmds.push({ method, params }); return {} } } }
  const cdpClick = async () => { cmds.push({ method: 'cdpClick' }) }
  const handleMethod = async () => { cmds.push({ method: 'selectAll' }) }
  const withDebugger = async (_tabId, f) => await f()
  const editorEl = makeEditorEl(kind, text)
  const execFunc = async (_fx, pageFn, ...args) => {
    const document = { querySelector: () => editorEl }
    const bound = new Function('document', `return (${pageFn.toString()})`)(document)
    return bound(...args)
  }
  const factory = new Function('cdpClick', 'handleMethod', 'withDebugger', 'chrome', 'execFunc',
    `${fnSrc}\nreturn typeIntoContentEditable`)
  const fn = factory(cdpClick, handleMethod, withDebugger, chrome, execFunc)
  await fn(1, null, '.edit_area', text, { x: 10, y: 10 })
  return cmds
}

const has = (cmds, method) => cmds.some(c => c.method === method)

async function test(name, f) {
  try { await f(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`) }
  catch (e) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`) }
}

async function main() {
  console.log('\n  -- RC1: editor-aware contenteditable input (composition opt-in) --\n')

  await test('typeIntoContentEditable exists', () => assert(fnSrc, 'helper must exist'))

  // ── custom editor (.edit_area): composition pipeline ──
  await test('custom editor: clear selection → compose → commit, in order', async () => {
    const cmds = await runType('你好世界', 'custom')
    const inserts = cmds.map((c, i) => ({ ...c, i })).filter(c => c.method === 'Input.insertText')
    const clear = inserts.find(c => c.params.text === '')
    const commit = inserts.find(c => c.params.text === '你好世界')
    const ime = cmds.findIndex(c => c.method === 'Input.imeSetComposition')
    assert(clear, 'must insertText("") to DELETE the select-all selection (composition does not clear it)')
    assert(ime !== -1, 'must call Input.imeSetComposition (the model listens for compositionstart/update)')
    assert(commit, 'must call Input.insertText(full text) to commit')
    assert(clear.i < ime, 'clear must precede composition')
    assert(ime < commit.i, 'composition must precede the commit insertText')
  })

  await test('custom editor: imeSetComposition carries full text, caret at end', async () => {
    const ime = (await runType('你好世界', 'custom')).find(c => c.method === 'Input.imeSetComposition')
    assert.equal(ime.params.text, '你好世界')
    assert.equal(ime.params.selectionStart, 4)
    assert.equal(ime.params.selectionEnd, 4)
  })

  await test('custom editor: empty text skips composition', async () => {
    assert(!has(await runType('', 'custom'), 'Input.imeSetComposition'), 'empty insert must not open a composition')
  })

  // ── native-insert editor (ProseMirror/Quill/CodeMirror): NO composition ──
  await test('ProseMirror: NO composition, NO clear — plain select-all + insertText (single replace)', async () => {
    const cmds = await runType('你好世界', 'prosemirror')
    assert(!has(cmds, 'Input.imeSetComposition'), 'native-insert editors must NOT get a composition (would double-insert)')
    const inserts = cmds.filter(c => c.method === 'Input.insertText')
    assert(!inserts.some(c => c.params.text === ''), 'must NOT do the clear-selection insertText("") (insertText replaces natively)')
    assert(inserts.length === 1 && inserts[0].params.text === '你好世界', 'exactly one insertText carrying the full text')
  })

  await test('ProseMirror: select-all still runs before the insert (replace existing content)', async () => {
    const cmds = await runType('xy', 'prosemirror')
    const sel = cmds.findIndex(c => c.method === 'selectAll')
    const ins = cmds.findIndex(c => c.method === 'Input.insertText')
    assert(sel !== -1 && sel < ins, 'select-all must precede insertText so it replaces existing content')
  })

  console.log(`\n  ${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}
main()
