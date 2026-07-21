/**
 * Shared test fixture: install the REAL globalThis.__tapDeep.
 *
 * Selector-bearing handlers (clickResolver, blurResolver, the type/fill injected
 * fns) reference globalThis.__tapDeep, installed once into the page MAIN world by
 * background.js's ensureDeep → execFunc(TAP_DEEP_INSTALL). Tests that EXTRACT and
 * EXECUTE those handlers in isolation (visible-click, blur-dispatch) must have the
 * same global present.
 *
 * Since 2026-07-21 the resolver lives in its own module (../tap-deep.js — the
 * single source of truth injected into the extension SW AND every peer). We now
 * IMPORT it and invoke it, so tests exercise the SHIPPING helper directly — no
 * regex extraction, no chance of a re-typed copy drifting.
 */
import { TAP_DEEP_INSTALL } from '../tap-deep.js'

TAP_DEEP_INSTALL() // sets globalThis.__tapDeep (idempotent)

if (!globalThis.__tapDeep || typeof globalThis.__tapDeep.all !== 'function' ||
    typeof globalThis.__tapDeep.control !== 'function') {
  throw new Error('_install-deep: TAP_DEEP_INSTALL did not set globalThis.__tapDeep.{all,control}')
}

export const tapDeep = globalThis.__tapDeep
