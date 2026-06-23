/**
 * Shared test fixture: install the REAL globalThis.__tapDeep.
 *
 * Selector-bearing handlers (clickResolver, blurResolver, the type/fill injected
 * fns) no longer inline their shadow-piercing helpers — they reference
 * globalThis.__tapDeep, installed once into the page MAIN world by background.js's
 * TAP_DEEP_INSTALL. Tests that EXTRACT and EXECUTE those handlers in isolation
 * (visible-click, blur-dispatch) must therefore have the same global present.
 *
 * Importing this module (side effect) extracts TAP_DEEP_INSTALL's source verbatim
 * from background.js and runs it, so the tests exercise the SHIPPING helper — not a
 * re-typed copy (which would drift). Handlers pass `document` explicitly to
 * __tapDeep.all(sel, document), so the install-time closure `document` (undefined
 * in Node) is never used; control() is element-relative and needs no document.
 */
import { readFileSync } from 'node:fs'

const BG_SRC = readFileSync(new URL('../background.js', import.meta.url), 'utf-8')

function extractArrowAfter(marker) {
  const start = BG_SRC.indexOf(marker)
  if (start === -1) throw new Error(`${marker} not found in background.js`)
  const open = BG_SRC.indexOf('(', start)
  const braceStart = BG_SRC.indexOf('{', open)
  let depth = 0
  for (let i = braceStart; i < BG_SRC.length; i++) {
    if (BG_SRC[i] === '{') depth++
    else if (BG_SRC[i] === '}') { depth--; if (depth === 0) return BG_SRC.slice(open, i + 1) }
  }
  throw new Error(`unbalanced braces after ${marker}`)
}

// `const TAP_DEEP_INSTALL = () => { ... }` → define + invoke (sets globalThis.__tapDeep)
const installSrc = extractArrowAfter('const TAP_DEEP_INSTALL = ')
new Function(`return (${installSrc})`)()()

if (!globalThis.__tapDeep || typeof globalThis.__tapDeep.all !== 'function' ||
    typeof globalThis.__tapDeep.control !== 'function') {
  throw new Error('_install-deep: TAP_DEEP_INSTALL did not set globalThis.__tapDeep.{all,control}')
}

export const tapDeep = globalThis.__tapDeep
