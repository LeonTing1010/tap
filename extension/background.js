/**
 * Tap Extension — Chrome Runtime
 *
 * Implements 8 core + 17 built-in operations.
 * Built-in uses chrome.scripting.executeScript({ func }) — real function injection,
 * immune to CSP. Only tap.eval (user string eval) needs CDP fallback for CSP sites.
 *
 * Architecture: same role as Playwright/macOS runtimes — full operation coverage.
 * Deno builtin.ts is the fallback for runtimes that only implement core.
 */

console.log('[tap] extension runtime ready')

// --- SW keep-alive: DELETED per ADR 2026-05-13-daemon-extension-via-native-messaging.md ---
//
// The prior two-layer defence (25s alarm + 4 wake hooks) compensated for
// the WS architecture's idle/hard-kill problems. PoC 2026-05-13 proved
// chrome.runtime.connectNative's port keeps the SW alive >19 minutes
// with zero traffic — crossing both the 30s idle threshold AND the
// 5-minute hard-kill threshold. Compensation no longer needed.
//
// When the SW does die (force-quit, OOM, browser restart), the next
// event that wakes Chrome will re-run this module's top-level code,
// which re-fires connectBridge() at the bottom of this file.

// --- State ---

// --- Session Manager ---
// Each MCP session owns a dedicated tab. Commands route via sessionId → tabId.
const sessions = new Map()  // sessionId → { tabId, url, interceptActive, networkCapturing }

// --- Session persistence ---
//
// MV3 service workers get killed after ~30s idle, wiping in-memory state.
// But Chrome tabs persist across SW restarts. Without persistence, a session
// created before SW idle becomes an orphan: `sessions.get(sid)` returns
// undefined on the next SW instance, session.destroy silently no-ops
// (returns {closed:false}), and the tab leaks forever.
//
// chrome.storage.session is in-memory but survives SW restarts within the
// same browser session — a perfect lifetime match for our session state.
// Rehydrate on startup, write-through on every mutation.
async function rehydrateSessions() {
  try {
    const stored = await chrome.storage.session.get('tap_sessions')
    const map = stored?.tap_sessions
    if (!map) return
    for (const [sid, s] of Object.entries(map)) {
      // Verify the tab still exists — user may have closed it manually while SW was down
      try {
        const tab = await chrome.tabs.get(s.tabId)
        sessions.set(sid, { ...s, url: tab.url || s.url || '' })
      } catch {
        /* tab gone — drop the session; rewrite below prunes stale entries */
      }
    }
    // Rewrite storage with the pruned set (drops any tab-gone sessions so
    // the next rehydrate doesn't have to re-check them).
    await chrome.storage.session.set({ tap_sessions: Object.fromEntries(sessions) })
    if (sessions.size > 0) console.log(`[tap] rehydrated ${sessions.size} sessions from storage`)
  } catch (e) {
    console.warn('[tap] session rehydrate failed:', e?.message)
  }
}

async function persistSessions() {
  try {
    await chrome.storage.session.set({ tap_sessions: Object.fromEntries(sessions) })
  } catch (e) {
    console.warn('[tap] session persist failed:', e?.message)
  }
}

// Kick off rehydrate at SW startup. Everything that reads `sessions` for
// command routing (WS dispatch) must await this before doing any work.
const rehydrateReady = rehydrateSessions()

const debuggerSessions = new Map()

// Network capture state (per-tab)
// Each capture: { entries: [], listening: boolean, pendingBodies: Set<Promise> }
// pendingBodies tracks in-flight Network.getResponseBody calls so networkDump
// can await them before returning — see comment on the listener below.
const networkCaptures = new Map()

// Per-tab in-flight request metadata, captured at Network.requestWillBeSent time.
// Maps tabId → Map<requestId, {method, url, hasPostData, postData}>
//
// Why we need this: Network.responseReceived doesn't carry the HTTP method
// (it has CDP ResourceType — "Fetch"/"XHR"/"Document" — which is NOT the same).
// We have to grab the method from requestWillBeSent and merge it in later.
// We also grab the inline postData here because it's already in the event params
// (Chrome inlines it for payloads up to ~640KB+) — no second CDP call needed.
const requestMeta = new Map()

// Per-tab intercept state for the Fetch domain (Phase B).
// Each state: { mode: "record" | "abort_writes", captured: [], listening: boolean }
//
// Unlike networkCaptures (Network domain, observation-only), interceptStates
// drives the Fetch domain which can BLOCK requests. The Fetch.requestPaused
// listener consults this state on every paused request to decide whether to
// continueRequest (record mode) or failRequest with errorReason:Aborted
// (abort_writes mode for write methods).
//
// CRITICAL: Fetch.enable WITHOUT a paired Fetch.requestPaused handler hangs
// every matching request indefinitely. The handler MUST always call either
// continueRequest or failRequest within the same handler invocation, or the
// page becomes unusable. The intercept.off cleanup must clear this state.
const interceptStates = new Map()

chrome.tabs.onRemoved.addListener((tabId) => {
  const dbgSession = debuggerSessions.get(tabId)
  if (dbgSession?.detachTimer) clearTimeout(dbgSession.detachTimer)
  debuggerSessions.delete(tabId)
  networkCaptures.delete(tabId)
  requestMeta.delete(tabId)
  interceptStates.delete(tabId)
  // Clean up any session that owned this tab
  let sessionRemoved = false
  for (const [sid, s] of sessions) {
    if (s.tabId === tabId) { sessions.delete(sid); sessionRemoved = true; break }
  }
  if (sessionRemoved) void persistSessions()
})

// --- Debugger Helpers (only for core.pointer, core.keyboard, core.eval CSP fallback) ---

function scheduleDetach(tabId) {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) clearTimeout(session.detachTimer)
  const timer = setTimeout(async () => {
    try { await chrome.debugger.detach({ tabId }) } catch {}
    debuggerSessions.delete(tabId)
  }, 5000)
  debuggerSessions.set(tabId, { ...session, detachTimer: timer })
}

async function ensureDebugger(tabId) {
  const session = debuggerSessions.get(tabId)
  if (session?.attached) return
  try {
    await Promise.race([
      chrome.debugger.attach({ tabId }, '1.3'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('debugger attach timeout')), 5000))
    ])
    debuggerSessions.set(tabId, { ...debuggerSessions.get(tabId), attached: true })
  } catch (e) {
    if (e.message?.includes('Already attached')) {
      debuggerSessions.set(tabId, { ...debuggerSessions.get(tabId), attached: true })
      await enablePageDomain(tabId)
      return
    }
    throw e
  }
  // Enable the Page domain so Page.javascriptDialogOpening is delivered to
  // handleDialogEvent — native dialogs fired mid-op are auto-handled instead of
  // hanging the op ~3.5min (2026-06-11 weixin dogfood). Best-effort: a failure
  // here must not break the attach the caller actually needs.
  await enablePageDomain(tabId)
}

async function enablePageDomain(tabId) {
  try { await chrome.debugger.sendCommand({ tabId }, 'Page.enable') } catch { /* benign */ }
}

async function withDebugger(tabId, fn) {
  await ensureDebugger(tabId)
  try { return await fn() }
  finally { scheduleDetach(tabId) }
}

// mouseMoved precedes press so hover/ripple-gated gesture recognizers
// (Polymer/Wiz `tap` — YouTube Studio ytcp-button; Material ripple) see the
// pointer enter the element first; a bare press/release at coords they never
// saw move to silently no-ops (#65 YouTube Studio edit-button dogfood).
async function cdpClick(tabId, x, y) {
  await withDebugger(tabId, async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none', buttons: 0
    })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1
    })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1
    })
  })
}

// Deliver keystroke-equivalent text into a contenteditable rich-text editor
// (Quill / ProseMirror / etc). The earlier `type` fallback dispatched per-char
// Input.dispatchKeyEvent({text}), which silently no-op'd on Quill (issue #19):
// it left the editor's model untouched yet returned success. CDP's
// Input.insertText drives the real beforeinput/input pipeline the editor's
// MutationObserver + model actually observe, matching human typing. After
// inserting we re-read the editor text and THROW if it didn't land, so a
// rejected edit surfaces as a failure instead of a silent success.
//
// `coords` is the element center (from a prior execFunc rect read). A real CDP
// click there establishes focus + caret/selection inside the editable frame —
// el.focus() alone does not place a caret, so insertText would have no
// selection to write into.
// `fx` is the execFunc target (tabId or {tabId, frameId}) for the re-read;
// `coords` arrive already translated to top-frame viewport space (#62).
async function typeIntoContentEditable(tabId, fx, selector, text, coords) {
  await cdpClick(tabId, coords.x, coords.y)
  // Select existing content so insertText REPLACES it (preserves the
  // select-all-then-type intent of the original `type` fallback). On an empty
  // editor this selects nothing and insertText just inserts at the caret.
  await handleMethod('keyboard', { tabId, key: 'a', action: 'press', modifiers: 4 })
  // Editor-aware composition (2026-06-12 weixin dogfood). Two kinds of
  // contenteditable need OPPOSITE handling:
  //  - Rich editors that manage their own input and handle Input.insertText
  //    natively (ProseMirror, Quill — issue #19 — CodeMirror) DOUBLE-insert if we
  //    also drive an IME composition (imeSetComposition replaces the selection AND
  //    the committing insertText adds a second copy: 被关注 ProseMirror → 2×). For
  //    these, plain select-all + insertText replaces in a single copy.
  //  - Custom contenteditables that commit their MODEL only on compositionend
  //    (WeChat msg-sender `.edit_area`: insertText filled the DOM but 确定 saw an
  //    EMPTY model; press/blur/op:eval-dispatch all failed) NEED the trusted IME
  //    pipeline imeSetComposition (compositionstart/update) → insertText (commit:
  //    compositionend + input).
  // So composition is opt-IN for editors we don't recognise as native-insert.
  const nativeInsertEditor = await execFunc(fx, (sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    return !!(el.closest && el.closest('.ProseMirror, .ql-editor, .CodeMirror, .cm-editor')) ||
      !!(el.classList && (el.classList.contains('ProseMirror') || el.classList.contains('ql-editor')))
  }, selector)
  await withDebugger(tabId, async () => {
    if (text && !nativeInsertEditor) {
      // imeSetComposition composes at the caret and does NOT clear an active
      // selection, so delete the select-all'd content first (insertText '' replaces
      // the selection with nothing) or the composition APPENDS to it (2026-06-12).
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: '' })
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Input.imeSetComposition', {
          text, selectionStart: text.length, selectionEnd: text.length,
        })
      } catch (_) { /* composition unsupported/refused — insertText below still commits */ }
    }
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text })
  })
  // Verify the mutation took effect (issue #19: no error, no effect). Compare
  // whitespace-stripped so rich-text wrapping (<p>/<br>) and newline
  // normalization don't trigger a false failure.
  const want = String(text ?? '').replace(/\s+/g, '')
  if (!want) return
  const after = await execFunc(fx, (sel) => {
    const el = document.querySelector(sel)
    return el ? (el.textContent ?? '') : null
  }, selector)
  if (after === null) throw new Error('Element not found: ' + selector)
  if (!String(after).replace(/\s+/g, '').includes(want)) {
    throw new Error(
      'input_ineffective: keystrokes did not mutate contenteditable ' + selector +
      ' — the editor rejected the synthesized input; for rich HTML use op:input kind=setHtml'
    )
  }
}

// --- Navigation Helper ---

// ADR 2026-05-14-op-nav-attach §2 — find an existing tab matching the
// target URL under the chosen match mode. Returns the most-recently-
// accessed match, or null if no match. Used by `case 'nav':` to
// implement find-or-create semantics when params.attach is set.
async function queryAttachCandidate(url, mode) {
  let target
  try { target = new URL(url) } catch { return null }

  let candidates
  if (mode === 'exact') {
    // chrome.tabs.query supports glob URLs but we want byte-equal match.
    const all = await chrome.tabs.query({})
    candidates = all.filter(t => t.url === url)
  } else if (mode === 'url-prefix') {
    const all = await chrome.tabs.query({})
    candidates = all.filter(t => t.url && t.url.startsWith(url))
  } else if (mode === 'origin') {
    const all = await chrome.tabs.query({})
    candidates = all.filter(t => {
      if (!t.url) return false
      try { return new URL(t.url).origin === target.origin }
      catch { return false }
    })
  } else {
    return null
  }

  if (candidates.length === 0) return null
  // Pick the most-recently-accessed candidate. `lastAccessed` is
  // a chrome.tabs.Tab field (ms since epoch); fall back to 0 when
  // absent (Chrome <122) — older tabs sort behind newer ones with
  // the field set.
  candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
  return candidates[0]
}

async function waitForTabLoad(tabId, url = null) {
  // MV3 fix: poll chrome.tabs.get() every 300ms instead of setTimeout(30s).
  // Long setTimeout lets Chrome kill the service worker (~30s idle limit).
  // Short API calls keep it alive.
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') break
    await new Promise(r => setTimeout(r, 300))
  }
  const tab = await chrome.tabs.get(tabId)
  if (tab.url?.startsWith('chrome-error://') || tab.url === '') {
    throw new Error(`Tab failed to load: ${url || tab.url}`)
  }
}

// --- Scripting Helper (CSP-immune function injection) ---

async function execFunc(t, func, ...args) {
  // t: tabId, or { tabId, frameId } from resolveFrame (#62 iframe targeting)
  const target = typeof t === 'object' ? { tabId: t.tabId, frameIds: [t.frameId] } : { tabId: t }
  const [result] = await chrome.scripting.executeScript({
    target, func, args, world: 'MAIN'
  })
  return result?.result
}

// Suppress the native beforeunload "Leave site?" dialog before we reload/navigate
// an existing tab. A dirty page (unsaved form) otherwise pops a native dialog that
// BLOCKS the navigation — and native dialogs aren't page DOM, so nothing in the op
// set can dismiss them and the relay just waits (2026-06-11 weixin self-menu dogfood:
// op:nav hung ~3.5 min on a dirty editor). onbeforeunload=null only covers the
// `window.onbeforeunload = fn` style; modern pages (WeChat mp) guard via
// addEventListener('beforeunload'), so we also add a CAPTURING listener that runs
// before the page handler, stops propagation, and clears returnValue (a non-empty
// returnValue is what fires the dialog). Best-effort — never block nav on failure.
async function neutralizeBeforeUnload(tabId) {
  const suppressBeforeUnload = () => {
    window.onbeforeunload = null
    window.addEventListener('beforeunload', (e) => {
      // Stop the page's own guard (the common addEventListener('beforeunload')
      // case) from running, and force returnValue empty so no dialog fires.
      // CRITICAL: do NOT call e.preventDefault() — on a beforeunload event that
      // REQUESTS the dialog (HTML spec), so calling it here made this suppressor
      // pop the very "Leave site?" it exists to kill (2026-06-12 dogfood: dirty
      // reload still hung ~3.5min). stopImmediatePropagation + returnValue=''
      // is the correct suppression.
      e.stopImmediatePropagation()
      e.returnValue = ''
    }, { capture: true })
  }
  try { await execFunc(tabId, suppressBeforeUnload) } catch (_) { /* best-effort */ }
}

// #62 frame-piercing combinator: "<iframe-sel> >>> <inner-sel>" addresses an
// element inside an iframe. chrome.scripting reaches cross-origin frames via
// frameIds (host_permissions) where page-JS contentDocument cannot, and the
// injection results carry frameId — so no webNavigation permission needed.
// Returns { t, sel, dx, dy }: execFunc target, inner selector, and the iframe's
// viewport offset so CDP coordinate ops (top-frame space) can be translated.
// Plain selectors pass through untouched. Single frame hop only.
const FRAME_SEP = ' >>> '
async function resolveFrame(tabId, sel) {
  if (!sel || !sel.includes(FRAME_SEP)) return { t: tabId, sel, dx: 0, dy: 0 }
  const i = sel.indexOf(FRAME_SEP)
  const frameSel = sel.slice(0, i), inner = sel.slice(i + FRAME_SEP.length)
  const meta = await execFunc(tabId, (fs) => {
    const f = document.querySelector(fs)
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { src: f.src || '', x: Math.round(r.x), y: Math.round(r.y) }
  }, frameSel)
  if (!meta) throw new Error('Element not found: ' + frameSel)
  let probes = []
  try {
    probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, world: 'MAIN',
      func: (s) => ({ hit: !!document.querySelector(s), href: location.href }),
      args: [inner],
    })
  } catch (e) { throw new Error('Element not found: ' + sel + ' (frame probe: ' + e.message + ')') }
  const hits = probes.filter(p => p.frameId !== 0 && p.result?.hit)
  if (!hits.length) throw new Error('Element not found: ' + sel)
  // Disambiguate by the iframe's resolved src when several frames match;
  // post-navigation the frame URL may drift from src, so fall back to first.
  const m = hits.find(p => meta.src && p.result.href === meta.src) || hits[0]
  return { t: { tabId, frameId: m.frameId }, sel: inner, dx: meta.x, dy: meta.y }
}

// --- Message Handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Popup ↔ SW status channel — separate envelope from the JSON-RPC
  // {method, params, id} shape used by external callers.
  if (msg?.type === 'tap-status') {
    // Surface extensionId + lastDisconnectReason so popup can render the
    // right CTA per failure mode (manifest missing vs host crash vs
    // Chrome anti-DoS blocklist). Without these, the popup can only show
    // a generic "bridge down" message that mis-directs the user.
    sendResponse({
      connected,
      version: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id,
      disconnectReason: lastDisconnectReason,
    })
    return false
  }
  if (msg?.type === 'tap-retry') {
    // User-initiated reconnect attempt — invoked by popup's "Retry" link.
    // connectBridge() is idempotent (no-op if `port` already open).
    try { connectBridge() } catch { /* surface via badge / next status poll */ }
    sendResponse({ ok: true })
    return false
  }
  if (!msg.method) { sendResponse({ id: msg.id, error: 'Missing method' }); return false }
  handleMethod(msg.method, msg.params, sender.tab?.id)
    .then(result => sendResponse({ id: msg.id, result }))
    .catch(error => sendResponse({ id: msg.id, error: error.message }))
  return true
})

async function handleMethod(method, params = {}, senderTabId = null, { fromDaemon = false } = {}) {
  let tabId = params.tabId ? Number(params.tabId) : null

  // Non-daemon callers (popup/content-script): auto-discover tab if none specified
  if (!tabId && !fromDaemon) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    tabId = tabs[0]?.id || null
  }

  // Methods that can work without a tab.
  // 'fetch' added 2026-05-04 (Framework v2.4 §二十 L2.5): SW-context fetch
  // with credentials:'include' uses Chrome's cookie jar directly — no tab
  // context needed. Same-origin enforcement is upstream (engine lint S1).
  const noTabNeeded = ['nav', 'tab', 'bookmark', 'tab.new', 'tab.list', 'tab.close', 'capabilities', 'reload',
                       'session.create', 'session.destroy', 'session.info',
                       'fetch']
  if (!tabId && !noTabNeeded.includes(method)) {
    throw new Error('No active tab. Call nav first or use session.create.')
  }

  switch (method) {

    case 'reload': {
      // Daemon broadcast: reload extension after tap update
      chrome.runtime.reload()
      return { ok: true }
    }

    // ========== CORE (8) — CDP for input, chrome.scripting for eval ==========

    case 'eval': {
      const safeExpr = '{\n' + params.expression + '\n}'

      // Fast path: debugger already attached
      if (debuggerSessions.get(tabId)?.attached) {
        try {
          const cdpExpr = '(async () => { return (0, eval)(' + JSON.stringify(safeExpr) + ') })()'
          const r = await chrome.debugger.sendCommand(
            { tabId }, 'Runtime.evaluate',
            { expression: cdpExpr, returnByValue: true, awaitPromise: true }
          )
          scheduleDetach(tabId)
          if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
          return r?.result?.value
        } catch (e) {
          if (!e.message?.includes('detached')) throw e
          debuggerSessions.delete(tabId)
        }
      }

      // Normal path: chrome.scripting (undetectable, but string eval blocked by CSP)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (expr) => {
          try { return { __ok: true, value: await (0, eval)(expr) } }
          catch (e) { return { __ok: false, error: e.message } }
        },
        args: [safeExpr],
        world: 'MAIN'
      })
      const wrapped = result?.result
      if (wrapped?.__ok) return wrapped.value

      // CSP/Trusted Types fallback: string eval blocked → use CDP
      if (wrapped?.error?.includes('Content Security Policy') || wrapped?.error?.includes('unsafe-eval') || wrapped?.error?.includes('Trusted Type')) {
        const cdpExpr = '(async () => { return (0, eval)(' + JSON.stringify(safeExpr) + ') })()'
        await ensureDebugger(tabId)
        const r = await Promise.race([
          chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate',
            { expression: cdpExpr, returnByValue: true, awaitPromise: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('CDP eval timeout')), 25000))
        ])
        scheduleDetach(tabId)
        if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
        return r?.result?.value
      }
      throw new Error(wrapped?.error || 'eval failed')
    }

    case 'pointer': {
      const { x, y, action = 'click' } = params
      if (action === 'click') await cdpClick(tabId, x, y)
      else if (action === 'move') await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }))
      else if (action === 'down') await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }))
      else if (action === 'up') await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }))
      return {}
    }

    case 'keyboard': {
      const { key, action = 'press', modifiers = 0 } = params
      const mapped = KEY_MAP[key] || {
        key, code: `Key${key.toUpperCase()}`,
        windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : key.charCodeAt(0)
      }
      const commands = []
      if (modifiers & 4) {
        const cmd = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }[key.toLowerCase()]
        if (cmd) commands.push(cmd)
      }
      await withDebugger(tabId, async () => {
        if (action === 'type') {
          for (const char of key) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char })
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', key: char })
          }
        } else if (action === 'down') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers, commands, ...mapped })
        } else if (action === 'up') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...mapped })
        } else {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyDown', modifiers, commands, ...mapped })
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...mapped })
        }
      })
      return {}
    }


    case 'nav': {
      const origTabId = tabId
      // created:true only at tabs.create sites; attachedNoReload = bind-only
      // attach (reload:false — never navigate the user's live tab).
      let createdByNav = false
      let attachedNoReload = false
      // Resolve current tab state. If the session's tab was closed behind our
      // back, chrome.tabs.get throws — fall through to "create new tab" and
      // rebind to the sessionId below (self-heal path).
      let current = null
      if (tabId) {
        try { current = await chrome.tabs.get(tabId) }
        catch { tabId = null }
      }
      // ADR 2026-05-14-op-nav-attach §2 — find-or-create. When the
      // sessionId has no bound tab (first nav in this session OR previous
      // tab closed) AND params.attach is set, try to attach to a matching
      // user tab before falling through to create. sessionStorage is
      // preserved when the matched tab is same-origin to params.url
      // (W3C: sessionStorage spans same-origin same-tab navigations) —
      // this is the entire point of attach (e.g. ASC, xie.infoq.cn).
      if (!tabId && params.attach) {
        const mode = params.attach === true ? 'url-prefix' : params.attach.match
        const matched = await queryAttachCandidate(params.url, mode)
        if (matched) {
          tabId = matched.id
          try {
            current = await chrome.tabs.get(tabId)
            if (params.attach !== true && params.attach.reload === false) attachedNoReload = true
          }
          catch { tabId = null; current = null }
        }
      }
      if (attachedNoReload) {
        // bind without navigating; session-sync below
      } else if (!tabId) {
        const tab = await chrome.tabs.create({ url: params.url, active: false })
        tabId = tab.id
        createdByNav = true
      } else {
        const isInternal = current.url?.startsWith('chrome://') || current.url?.startsWith('data:')
        // ADR 2026-05-08-failure-detection-phase-2 §2C(iii) — compute
        // target vs current origin to decide tabs.update vs tabs.create.
        // Cross-origin nav must NOT clobber an existing tab: the previous
        // page may be in a redirect chain (e.g. CF auth) whose state
        // would leak into the eval that follows. Same-origin SPA navs
        // remain cheap (tabs.update).
        let crossOrigin = false
        try {
          const target = new URL(params.url)
          if (current.url) {
            const currentParsed = new URL(current.url)
            crossOrigin = target.origin !== currentParsed.origin
          }
        } catch {
          // Malformed URL — treat as cross-origin (safer: open new tab)
          crossOrigin = true
        }
        if (isInternal || crossOrigin) {
          // chrome:// / data:// (§2C(ii)) OR cross-origin (§2C(iii)) →
          // open new bg tab. SAA self-heal below binds tabId to sessionId
          // (no daemon round-trip per ADR 2026-05-10-saa-page-session-
          // fetch-cross-repo).
          const tab = await chrome.tabs.create({ url: params.url, active: false })
          tabId = tab.id
          createdByNav = true
        } else {
          // Same-origin SPA-style nav: cheap tabs.update (not createdByNav).
          // Neutralize beforeunload first so a dirty page's "Leave site?" native
          // dialog can't block the nav and hang the relay (2026-06-11 dogfood).
          await neutralizeBeforeUnload(tabId)
          await chrome.tabs.update(tabId, { url: params.url })
        }
      }
      if (!attachedNoReload) await waitForTabLoad(tabId, params.url)
      const finalTab = await chrome.tabs.get(tabId)
      // Update session: URL always, tabId if replaced.
      let sessionUpdated = false
      for (const [, s] of sessions) {
        if (s.tabId === origTabId || s.tabId === tabId) {
          s.url = finalTab.url || params.url
          s.tabId = tabId
          sessionUpdated = true
          break
        }
      }
      // Self-heal: daemon passed a sessionId but no matching session entry
      // (tab was closed, SW missed the onRemoved, or entry was never created
      // via session.create). Bind the freshly-navigated tab to that sessionId
      // so subsequent commands resolve instead of throwing "No active tab"
      // forever. Without this the MCP main session stays orphaned for life.
      //
      // 2026-05-18 fix: dropped `!sessionUpdated &&` short-circuit. Multiple
      // sessionIds can legitimately share one tab (cross-Run attach reuse:
      // Run-A interactive lifecycle leaves sid-A bound to the user's tab;
      // Run-B navs via op:nav.attach to the same tab → for-loop above syncs
      // sid-A's URL, but sid-B must STILL get bound here, otherwise eval in
      // Run-B fails with "No active tab"). The two paths operate on
      // different sessions entries and don't conflict.
      const sid = params._sessionId
      if (fromDaemon && sid && !sessions.has(sid)) {
        sessions.set(sid, {
          tabId, url: finalTab.url || params.url,
          interceptActive: false, networkCapturing: false,
        })
        sessionUpdated = true
      }
      if (sessionUpdated) void persistSessions()
      return { frameId: 'main', tabId, url: finalTab.url || params.url, created: createdByNav }
    }

    case 'wait': {
      // op:wait selector-mode arrives here (NM bridge maps op name → method
      // verbatim); the selector was historically IGNORED — Math.min(undefined)
      // = NaN ms sleep → instant ok, violating the peer-conformance contract
      // (wait selector miss → selector_not_found). Delegate to waitFor (which
      // also gives selector-waits >>> frame piercing, #62) and map its
      // timeout onto the contracted wire code.
      if (params.selector) {
        try {
          await handleMethod('waitFor', { tabId, selector: params.selector, ms: params.timeout_ms }, senderTabId, { fromDaemon })
        } catch (e) {
          const m = String(e?.message || e)
          if (m.startsWith('waitFor timeout')) throw new Error('selector_not_found: ' + params.selector + ' (wait timed out)')
          throw e
        }
        return {}
      }
      await new Promise(r => setTimeout(r, Math.min(params.ms, 25000)))
      return {}
    }

    case 'screenshot': {
      const fmt = params.format || 'jpeg'
      const quality = params.quality ?? 50
      const target = params.target
      const data = await withDebugger(tabId, async () => {
        let clip
        if (target) {
          // Resolve selector → bounding rect in page context, then pass as clip.
          // Mirrors the Playwright `locator(target).screenshot()` path used by
          // src/runtime-playwright.ts so vision plan op behaves identically.
          const expr = `(() => {
            const el = document.querySelector(${JSON.stringify(target)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          })()`
          const evalRes = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: expr, returnByValue: true,
          })
          const rect = evalRes?.result?.value
          if (!rect) throw new Error(`screenshot: target not found: ${target}`)
          if (rect.width <= 0 || rect.height <= 0) {
            throw new Error(`screenshot: target has zero size: ${target}`)
          }
          clip = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
        }
        const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
          format: fmt, quality, ...(clip ? { clip } : {}),
        })
        return result.data
      })
      return { data }
    }

    case 'cookies': {
      const tab = await chrome.tabs.get(tabId)
      return { cookies: await chrome.cookies.getAll({ url: tab.url }) }
    }

    case 'storage': {
      const s = (params.type || 'local') === 'session' ? chrome.storage.session : chrome.storage.local
      return { data: await s.get(null) }
    }

    case 'capabilities':
      return {
        runtime: 'extension', version: '0.6.5',
        supports: [
          'eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'cookies', 'storage',
          'input', 'click', 'type', 'fill', 'hover', 'blur', 'scroll', 'pressKey', 'select',
          'fetch', 'find', 'download', 'waitFor', 'waitForNetwork', 'ssrState', 'copyAll',
          'upload', 'dialog', 'extract',
          'tab.new', 'tab.list', 'tab.close',
          'inspect.page', 'inspect.networkStart', 'inspect.networkDump', 'inspect.networkStop',
          'intercept.on', 'intercept.off',
          'session.create', 'session.destroy', 'session.info'
        ]
      }

    // op:input — v2 InputOp envelope. Routes {kind, target, value} to the
    // existing kind-specific handlers below. Error normalization: when a
    // child handler throws "Element not found", rewrite to "selector_not_found:"
    // so classifyExtensionError maps to WIRE_CODE.selector_not_found
    // (peer-conformance.ts requires this kind for selector miss).
    case 'input': {
      const { kind, target, value, ...rest } = params
      try {
        switch (kind) {
          case 'click':
            return await handleMethod('click', { ...rest, target }, senderTabId, { fromDaemon })
          case 'type':
            return await handleMethod('type', { ...rest, selector: target, text: value }, senderTabId, { fromDaemon })
          case 'fill':
            return await handleMethod('fill', { ...rest, selector: target, text: value }, senderTabId, { fromDaemon })
          case 'setHtml':
            return await handleMethod('setHtml', { ...rest, selector: target, html: value }, senderTabId, { fromDaemon })
          case 'press':
            return await handleMethod('pressKey', { ...rest, key: value }, senderTabId, { fromDaemon })
          case 'upload':
            return await handleMethod('upload', { ...rest, selector: target, files: value }, senderTabId, { fromDaemon })
          case 'hover':
            // Trusted mouseMoved only (no press/release) — opens hover-triggered
            // overlays (Ant Dropdown trigger=['hover'], MUI tooltips) that a JS
            // el.click() can't, and that a trusted click would open-then-toggle-shut.
            return await handleMethod('hover', { ...rest, selector: target }, senderTabId, { fromDaemon })
          case 'keytype':
            // Real CDP keystrokes (vs fill/type's value-setter) — for framework
            // inputs whose store only commits on genuine key events.
            return await handleMethod('keytype', { ...rest, selector: target, text: value }, senderTabId, { fromDaemon })
          case 'blur':
            // Commit gesture for blur-flushing form stores (Ant rc-field-form
            // nested list items et al): typed value only enters the framework
            // model on a REAL focus loss. el.blur() yields UA-generated
            // (trusted) blur/focusout. End form-fill sequences with this on
            // the last field before clicking save (2026-06-11 beian lesson).
            return await handleMethod('blur', { ...rest, selector: target }, senderTabId, { fromDaemon })
        }
        throw new Error(`Unknown op:input kind: ${kind}`)
      } catch (e) {
        const msg = String(e?.message || e)
        if (msg.startsWith('Element not found')) {
          throw new Error(`selector_not_found: ${target}`)
        }
        throw e
      }
    }

    // ========== BUILT-IN (17) — chrome.scripting func injection, zero CSP issues ==========

    case 'click': {
      const { t: fx, sel: target, dx, dy } = await resolveFrame(tabId, params.target || params.selector)
      // JS-first: use el.click() via execFunc — no debugger, no yellow bar, CSP-immune
      // Named + self-contained so it injects via execFunc AND is extractable by
      // test/visible-click.test.mjs (background.js isn't node-importable — chrome.*).
      const clickResolver = (t) => {
        // Prefer the first VISIBLE match. document.querySelector returns the first
        // DOM match even if display:none/hidden — which clicked a hidden "退出登录"
        // sharing .weui-desktop-btn_primary in the 2026-06-11 weixin self-menu
        // dogfood and logged the session out. Below-fold (scrolled) elements keep
        // size>0 so they still resolve; only display:none/hidden/zero-box are skipped.
        const vis = (e) => {
          if (!e) return false
          const s = (typeof getComputedStyle === 'function') ? getComputedStyle(e) : null
          if (s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0')) return false
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }
        let el = document.querySelector(t)
        if (el && !vis(el)) {
          for (const e of document.querySelectorAll(t)) { if (vis(e)) { el = e; break } }
        }
        if (!el) {
          for (const e of document.querySelectorAll('a, button, [role="button"], input, [onclick], [tabindex]')) {
            if ((e.textContent?.trim().toLowerCase().includes(t.toLowerCase())) ||
                (e.getAttribute('aria-label')?.toLowerCase().includes(t.toLowerCase()))) { el = e; break }
          }
        }
        if (!el) {
          const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
          let n; while (n = walk.nextNode()) {
            if (n.textContent?.trim().toLowerCase().includes(t.toLowerCase()) && n.children.length === 0) { el = n; break }
          }
        }
        if (!el) throw new Error('Element not found: ' + t)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.click()
        const r = el.getBoundingClientRect()
        return { clicked: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }
      const result = await execFunc(fx, clickResolver, target)
      if (!result) throw new Error('selector_not_found: ' + target + ' (page not ready — exec returned null)')
      // CDP fallback: if site needs isTrusted events, retry with cdpClick
      // (dx/dy translate frame-relative coords to top-frame viewport space)
      if (params.trusted) {
        await cdpClick(tabId, result.x + dx, result.y + dy)
      }
      return {}
    }

    case 'type': {
      const { text } = params
      const { t: fx, sel: selector, dx, dy } = await resolveFrame(tabId, params.selector)
      const probe = await execFunc(fx, (sel, txt) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        // #61: resolve the real form control — directly, or the native <input>
        // nested inside a web component's (possibly nested) open shadow root.
        // Masked inputs (air3 currency, faceplate-text-input) expose no .value on
        // the custom-element host; the inner control is the write target.
        // deepControl pierces open shadow roots to a bounded depth, then null.
        const deepControl = (n, d) => {
          if (!n || d > 4) return null
          if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return n
          const root = n.shadowRoot || n
          const hit = root.querySelector && root.querySelector('input, textarea, select')
          if (hit) return hit
          for (const h of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
            if (h.shadowRoot) { const r = deepControl(h, d + 1); if (r) return r }
          }
          return null
        }
        const C = deepControl(el, 0)
        if (C) {
          C.focus()
          const proto = C.tagName === 'SELECT' ? HTMLSelectElement.prototype
            : C.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          try { setter ? setter.call(C, txt) : (C.value = txt) } catch (_) { try { C.value = txt } catch (_) {} }
          try { // #60: swallow masked-input handler throw; value already set
            C.dispatchEvent(new Event('input', { bubbles: true }))
            C.dispatchEvent(new Event('change', { bubbles: true }))
          } catch (_) { /* value persisted */ }
          return { mode: 'done' }
        }
        const r = el.getBoundingClientRect()
        const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
        // contenteditable → trusted keystrokes via CDP Input.insertText (issue
        // #19). Other non-input widgets that merely LISTEN to key events keep
        // the legacy per-char dispatchKeyEvent path — insertText would not fire
        // their keydown handlers.
        return { mode: el.isContentEditable ? 'contenteditable' : 'keys', x, y }
      }, selector, text)
      if (!probe) throw new Error('type: page-context value-set failed for selector: ' + selector)
      if (probe.mode === 'contenteditable') {
        await typeIntoContentEditable(tabId, fx, selector, text, { x: probe.x + dx, y: probe.y + dy })
      } else if (probe.mode === 'keys') {
        await cdpClick(tabId, probe.x + dx, probe.y + dy)
        await handleMethod('keyboard', { tabId, key: 'a', action: 'press', modifiers: 4 })
        await handleMethod('keyboard', { tabId, key: text, action: 'type' })
        // issue #19's lesson, generalized: per-char dispatchKeyEvent({text}) silently
        // no-ops on some framework editors (weixin `.emotion_editor`, 2026-06-11
        // dogfood) — and UNLIKE the contenteditable path this branch had NO
        // post-verify, so zero-effect typing returned success (6 attempts chasing a
        // silent no-op). Verify the text landed, GATED to editor contexts so the
        // key-LISTENER widgets this path exists for never false-fail.
        const keysLanded = (s, want) => {
          const el = document.querySelector(s)
          if (!el) return { found: false, editorish: false, has: false }
          const editorish = !!el.isContentEditable
            || !!(el.querySelector && el.querySelector('[contenteditable=""],[contenteditable=true]'))
            || !!(el.closest && el.closest('[contenteditable=""],[contenteditable=true]'))
          const txt = (el.innerText || el.textContent || '')
          const w = String(want == null ? '' : want).replace(/\s+/g, '')
          return { found: true, editorish, has: w ? txt.replace(/\s+/g, '').includes(w) : true }
        }
        const chk = await execFunc(fx, keysLanded, selector, text)
        if (chk && chk.found && chk.editorish && !chk.has) {
          throw new Error(
            'input_ineffective: per-char keystrokes did not land in editor ' + selector +
            ' — the editor rejected synthesized key events; try op:input kind=setHtml, or capture the write API and replay via op:fetch'
          )
        }
      }
      return {}
    }

    case 'fill': {
      const { text } = params
      const { t: fx, sel: selector, dx, dy } = await resolveFrame(tabId, params.selector)
      const probe = await execFunc(fx, (sel, txt) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        // contenteditable rich-text editors have no .value — the value-setter
        // path below is a silent no-op (issue #19). Defer to trusted keystrokes
        // so the editor's framework state matches human typing.
        if (el.isContentEditable) {
          const r = el.getBoundingClientRect()
          return { mode: 'contenteditable', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        }
        // #61: resolve the real form control — directly or nested inside a web
        // component's (possibly nested) open shadow root. deepControl mirrors the
        // `type` handler so both kinds write masked / web-component inputs (e.g.
        // air3 currency, faceplate-text-input) where .value lives on the inner
        // <input>, not the custom-element host.
        const deepControl = (n, d) => {
          if (!n || d > 4) return null
          if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return n
          const root = n.shadowRoot || n
          const hit = root.querySelector && root.querySelector('input, textarea, select')
          if (hit) return hit
          for (const h of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
            if (h.shadowRoot) { const r = deepControl(h, d + 1); if (r) return r }
          }
          return null
        }
        const T = deepControl(el, 0) || el // #61 web-component inner input
        if (T !== el && T.focus) T.focus()
        const proto = T.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : T.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        try { setter ? setter.call(T, txt) : (T.value = txt) } catch (_) { try { T.value = txt } catch (_) {} }
        try { T.dispatchEvent(new Event('input', { bubbles: true })); T.dispatchEvent(new Event('change', { bubbles: true })) } catch (_) {}
        return { mode: 'done' }
      }, selector, text)
      if (probe?.mode === 'contenteditable') {
        await typeIntoContentEditable(tabId, fx, selector, text, { x: probe.x + dx, y: probe.y + dy })
      }
      return {}
    }

    case 'keytype': {
      // Real CDP keystrokes into a real <input>/<textarea>: trusted click to
      // focus → select-all → type char-by-char. `fill`/`type` write the DOM
      // .value via the native setter, which updates React's tracked value but
      // NOT every framework store — Ant rc-field-form's 特征信息 list-item fields
      // (beian.aliyun.com 公钥/MD5) keep an EMPTY store, so save validates empty
      // and reports "格式错误" despite the DOM showing the value. Genuine key
      // events drive the component's own onChange, committing the store.
      const { t: fx, sel, dx, dy } = await resolveFrame(tabId, params.selector)
      const coords = await execFunc(fx, (s) => {
        const el = document.querySelector(s)
        if (!el) throw new Error('Element not found: ' + s)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, sel)
      if (!coords) throw new Error('selector_not_found: ' + sel + ' (page not ready — exec returned null)')
      // Real CDP click establishes focus + caret; select-all so insertText
      // REPLACES any existing value; Input.insertText drives the native
      // beforeinput/input pipeline (per-char dispatchKeyEvent({text}) silently
      // no-ops on some framework inputs — same lesson as the contenteditable
      // path above, issue #19).
      await cdpClick(tabId, coords.x + dx, coords.y + dy)
      await handleMethod('keyboard', { tabId, key: 'a', action: 'press', modifiers: 4 })
      await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: String(params.text ?? '') }))
      // Verify it landed (issue #19: no error, no effect) — re-read the control.
      // contenteditable has no .value — read innerText/textContent there, else .value.
      // (2026-06-11 weixin dogfood: keytype into a contenteditable .edit_area threw a
      // false "value did not land (len 0)" because the verify-read used .value on a
      // <div>.) Named + self-contained so it injects AND is extractable by
      // test/keytype-verify.test.mjs.
      const readControlValue = (s) => {
        const el = document.querySelector(s)
        if (!el) return null
        return el.isContentEditable ? (el.innerText || el.textContent || '') : (el.value || '')
      }
      const got = await execFunc(fx, readControlValue, sel)
      if ((got || '').replace(/\s+/g, '') !== String(params.text ?? '').replace(/\s+/g, '')) {
        throw new Error(`keytype: value did not land for selector: ${sel} (got len ${(got || '').length})`)
      }
      return {}
    }

    case 'setHtml': {
      // Rich-HTML injection for contenteditable / rich-text editors (e.g. ProseMirror).
      // Mirrors 'fill' but assigns innerHTML instead of .value. The html arrives
      // already-substituted (op:input value receives {{$args}} as DATA in core),
      // so large per-run HTML flows in without baking it into an op:eval literal.
      const { html } = params
      const { t: fx, sel: selector } = await resolveFrame(tabId, params.selector)
      await execFunc(fx, (sel, h) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        el.innerHTML = h
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('blur', { bubbles: true }))
      }, selector, html)
      return {}
    }

    case 'hover': {
      const { t: fx, sel, dx, dy } = await resolveFrame(tabId, params.selector)
      const coords = await execFunc(fx, (s) => {
        const el = document.querySelector(s)
        if (!el) throw new Error('Element not found: ' + s)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, sel)
      // null exec = page mid-navigation → typed miss, not "reading 'x'"
      if (!coords) throw new Error('selector_not_found: ' + sel + ' (page not ready)')
      await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x + dx, y: coords.y + dy }))
      return {}
    }

    case 'blur': {
      // Commit gesture: real focus loss via el.blur() — the UA generates
      // trusted blur/focusout, which blur-flushing form stores (Ant
      // rc-field-form list items) require before save validates the model.
      // Pierces open shadow roots to the inner form control (same
      // deepControl contract as fill/type, #61).
      const { t: fx, sel } = await resolveFrame(tabId, params.selector)
      const done = await execFunc(fx, (s) => {
        const el = document.querySelector(s)
        if (!el) throw new Error('Element not found: ' + s)
        const deepControl = (n, d) => {
          if (!n || d > 4) return null
          if (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) return n
          const root = n.shadowRoot || n
          const hit = root.querySelector && root.querySelector('input, textarea, select')
          if (hit) return hit
          for (const h of (root.querySelectorAll ? root.querySelectorAll('*') : [])) {
            if (h.shadowRoot) { const r = deepControl(h, d + 1); if (r) return r }
          }
          return null
        }
        const C = deepControl(el, 0) || el
        // If the control isn't the active element, focus it first so the
        // subsequent blur is a REAL transition (blur on an unfocused node
        // is a no-op and commits nothing).
        const doc = C.getRootNode ? C.getRootNode() : document
        if ((doc.activeElement || document.activeElement) !== C && C.focus) C.focus()
        if (C.blur) C.blur()
        return { blurred: true }
      }, sel)
      if (!done) throw new Error('selector_not_found: ' + sel + ' (page not ready — exec returned null)')
      return {}
    }

    case 'scroll': {
      const { t: fx, sel } = await resolveFrame(tabId, params.selector || '')
      await execFunc(fx, (s) => {
        const el = s ? document.querySelector(s) : null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        else window.scrollBy({ top: 500, behavior: 'smooth' })
      }, sel)
      return {}
    }

    case 'pressKey':
      // Propagate tabId so the keystroke lands on the dispatch-target tab, not
      // whatever tab happens to be active (issue #19: press was a silent no-op
      // when the bound tab ≠ the active tab).
      return handleMethod('keyboard', { tabId, key: params.key, action: 'press', modifiers: params.modifiers || 0 })

    case 'select': {
      const { t: fx, sel } = await resolveFrame(tabId, params.selector)
      await execFunc(fx, (s, val) => {
        const el = document.querySelector(s)
        if (!el) throw new Error('Element not found: ' + s)
        el.value = val
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, sel, params.value)
      return {}
    }

    case 'fetch': {
      // Two paths:
      //   credentials="page-session"  → page-context fetch via
      //     chrome.scripting.executeScript({world:'MAIN'}). Uses the
      //     page's REAL TLS fingerprint, defeating Cloudflare /
      //     similar fingerprint-based bot detection. Honors the
      //     `credentials:"page-session"` semantic literally instead of
      //     the prior shortcut (SW fetch with cookies — same cookie
      //     jar, but DIFFERENT TLS fingerprint, so CF would 403).
      //     Discovered via yfsp.tv 2026-05-05; see commit message.
      //   credentials="deno-host" or unset → SW-direct fetch. Faster
      //     (saves the chrome.scripting hop) but visible-as-bot to
      //     fingerprint-based gates. Authors who don't need bot
      //     evasion should keep this path.
      const {
        url, format, headers, body,
        method: httpMethod,
        tabId: explicitTabId,
        _sessionId: _ignoredSession,
        credentials: _tapCredentials,
        save: _tapSave,
        ...rest
      } = params
      const init = {
        credentials: 'include',
        method: httpMethod || 'GET',
      }
      if (headers) init.headers = headers
      if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body)
        init.headers = init.headers || {}
        if (!init.headers['content-type'] && !init.headers['Content-Type']) {
          init.headers['content-type'] = 'application/json'
        }
      }
      Object.assign(init, rest)

      // ─── page-session path (CF-bypass via real TLS fingerprint) ───
      if (_tapCredentials === 'page-session') {
        if (!explicitTabId) {
          // Per ADR 2026-05-10-saa-page-session-fetch-cross-repo: page-session
          // fetch is structurally TabBound. The dispatch envelope's sessionId
          // (engine's run_id) must already be bound to a tab via a prior
          // op:nav within the same plan. If we land here with no tabId,
          // either (a) plan has no preceding op:nav, or (b) op:nav ran but
          // the session-as-actor self-heal at handleMethod 'nav' did not
          // populate sessions[sessionId]. Author fix: ensure the plan starts
          // with op:nav (or session.create) before any page-session fetch.
          throw new Error('op:fetch failed: ' + JSON.stringify({
            kind: 'navigation_blocked',
            message: 'page-session fetch needs an active tab — plan must precede this fetch with op:nav (or session.create) so the dispatch sessionId is bound to a tab',
            url,
          }))
        }
        const fmt = format || 'json'
        let scriptResult
        try {
          [scriptResult] = await chrome.scripting.executeScript({
            target: { tabId: explicitTabId },
            world: 'MAIN',
            func: async (url, init, fmt) => {
              try {
                const res = await fetch(url, init)
                const ct = res.headers.get('content-type') || ''
                if (!res.ok) {
                  const text = await res.text().catch(() => '')
                  return { __ok: false, kind: 'http_error', status: res.status, statusText: res.statusText, url: res.url, contentType: ct, body: text.slice(0, 16384) }
                }
                if (fmt === 'text') return { __ok: true, value: await res.text() }
                if (fmt === 'arrayBuffer') { const ab = await res.arrayBuffer(); return { __ok: true, value: Array.from(new Uint8Array(ab)) } }
                const text = await res.text()
                try { return { __ok: true, value: JSON.parse(text) } }
                catch (_e) { return { __ok: false, kind: 'parse_error', url: res.url, body: text.slice(0, 16384) } }
              } catch (e) {
                return { __ok: false, kind: 'network_error', message: String(e && e.message || e), url }
              }
            },
            args: [url, init, fmt]
          })
        } catch (e) {
          // chrome.scripting itself failed (tab gone, missing permissions, restricted URL).
          throw new Error('op:fetch failed: ' + JSON.stringify({
            kind: 'tab_closed',
            message: String(e && e.message || e),
            url, tabId: explicitTabId,
          }))
        }
        const r = scriptResult && scriptResult.result
        if (!r) {
          throw new Error('op:fetch failed: ' + JSON.stringify({
            kind: 'tab_closed',
            message: 'chrome.scripting returned no result (page navigated mid-fetch?)',
            url, tabId: explicitTabId,
          }))
        }
        if (!r.__ok) {
          throw new Error('op:fetch failed: ' + JSON.stringify(r))
        }
        return r.value
      }

      // ─── SW-direct path (deno-host / no fingerprint requirement) ──
      let res
      try {
        res = await fetch(url, init)
      } catch (e) {
        throw new Error('op:fetch failed: ' + JSON.stringify({
          kind: 'network_error',
          message: String(e?.message || e),
          url,
        }))
      }
      const ct = res.headers.get('content-type') || ''
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error('op:fetch failed: ' + JSON.stringify({
          kind: 'http_error',
          status: res.status, statusText: res.statusText,
          url: res.url, contentType: ct,
          body: text.slice(0, 16384),
        }))
      }
      const fmt = format || 'json'
      if (fmt === 'text') return await res.text()
      if (fmt === 'arrayBuffer') {
        const ab = await res.arrayBuffer()
        return Array.from(new Uint8Array(ab))
      }
      // Default JSON: read text first so a parse failure can surface body.
      const text = await res.text()
      try { return JSON.parse(text) }
      catch (_e) {
        throw new Error('op:fetch failed: ' + JSON.stringify({
          kind: 'parse_error', parser: 'json',
          status: res.status, url: res.url, contentType: ct,
          body: text.slice(0, 16384),
        }))
      }
    }

    case 'find': {
      return await execFunc(tabId, (q, r) => {
        const vw = window.innerWidth, vh = window.innerHeight
        function region(rect) {
          const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
          return (cy < vh/3 ? 'top' : cy > vh*2/3 ? 'bottom' : 'middle') + '-' +
                 (cx < vw/3 ? 'left' : cx > vw*2/3 ? 'right' : 'center')
        }
        function quickSel(el) {
          if (el.id) return '#' + el.id
          const cls = Array.from(el.classList || []).filter(c => !/^(svelte-|css-|_|sc-)/.test(c)).slice(0, 2)
          return cls.length ? el.tagName.toLowerCase() + '.' + cls.join('.') : el.tagName.toLowerCase()
        }
        function allEls(root) {
          const out = []
          for (const el of root.querySelectorAll('*')) {
            out.push(el)
            if (el.shadowRoot) allEls(el.shadowRoot).forEach(e => out.push(e))
          }
          return out
        }
        function isVis(el) {
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) return false
          if (el.offsetParent === null && el !== document.body && !el.getRootNode()?.host) return false
          return true
        }
        return allEls(document).filter(el => {
          if (!isVis(el)) return false
          const text = el.innerText?.trim() || ''
          if (!text.toLowerCase().includes(q.toLowerCase())) return false
          if (r && el.getAttribute('role') !== r) return false
          for (const child of el.children) {
            if (child.innerText?.trim().toLowerCase().includes(q.toLowerCase()) && isVis(child)) return false
          }
          return true
        }).slice(0, 20).map(el => {
          const rect = el.getBoundingClientRect()
          return {
            tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
            text: (el.innerText?.trim() || '').substring(0, 120), selector: quickSel(el),
            box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
            region: region(rect),
            visible_in_viewport: rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0
          }
        })
      }, params.query, params.role || '')
    }

    case 'download': {
      return await execFunc(tabId, async (url) => {
        const res = await fetch(url, { credentials: 'include' })
        const ct = res.headers.get('content-type') || ''
        return ct.includes('json') ? res.json() : res.text()
      }, params.url)
    }

    case 'waitFor': {
      const ms = Math.min(params.ms || 10000, 25000)
      // Frame-piercing wait: resolveFrame's probe hit IS the wait condition
      // (element exists in some frame) — poll it instead of one-shot resolving,
      // since the iframe itself may still be loading (#62).
      if (params.selector?.includes(FRAME_SEP)) {
        const end = Date.now() + ms
        for (;;) {
          try { await resolveFrame(tabId, params.selector); return {} }
          catch (e) {
            if (Date.now() > end) throw new Error('waitFor timeout: ' + params.selector)
            await new Promise(r => setTimeout(r, 300))
          }
        }
      }
      await execFunc(tabId, (sel, timeout) => {
        if (document.querySelector(sel)) return true
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { obs.disconnect(); reject(new Error('waitFor timeout: ' + sel)) }, timeout)
          const obs = new MutationObserver(() => {
            if (document.querySelector(sel)) { obs.disconnect(); clearTimeout(timer); resolve(true) }
          })
          obs.observe(document.documentElement, { childList: true, subtree: true })
        })
      }, params.selector, ms)
      return {}
    }

    case 'waitForNetwork': {
      await new Promise(r => setTimeout(r, Math.min(params.ms || 3000, 25000)))
      return {}
    }

    case 'ssrState': {
      return await execFunc(tabId, (name) => {
        const sanitize = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v))
        if (name) {
          const val = window[name]
          if (val === undefined) return null
          try { return sanitize(val) } catch { return null }
        }
        const names = ['__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__',
          '__PRELOADED_STATE__', '__APP_DATA__', '__SSR_DATA__', '__APOLLO_STATE__',
          '__RELAY_STORE__', '__pinia', '__INITIAL_SSR_STATE__']
        const found = {}
        for (const n of names) {
          if (window[n] !== undefined) try { found[n] = sanitize(window[n]) } catch {}
        }
        return Object.keys(found).length ? found : null
      }, params.name || '')
    }

    case 'copyAll':
      return await execFunc(tabId, () => document.body.innerText)

    case 'extract': {
      const { t: fx, sel } = await resolveFrame(tabId, params.selector)
      const fields = params.fields
      return await execFunc(fx, (rowSel, fieldMap) => {
        return Array.from(document.querySelectorAll(rowSel)).map(row => {
          const obj = {}
          for (const [name, spec] of Object.entries(fieldMap)) {
            const atIdx = spec.indexOf('@')
            if (atIdx > 0) {
              const elSel = spec.substring(0, atIdx)
              const attr = spec.substring(atIdx + 1)
              obj[name] = row.querySelector(elSel)?.getAttribute(attr) || ''
            } else {
              obj[name] = row.querySelector(spec)?.textContent?.trim() || ''
            }
          }
          return obj
        })
      }, sel, fields)
    }

    case 'upload': {
      // Frame-piercing upload (#62): the pierced DOM tree does not let
      // DOM.querySelector cross document boundaries, so resolve the inner
      // input via page-JS contentDocument (same-origin frames) and hand its
      // objectId straight to setFileInputFiles. Cross-origin frames are
      // separate CDP targets (OOPIF) — fail with a clear message.
      if (params.selector?.includes(FRAME_SEP)) {
        const i = params.selector.indexOf(FRAME_SEP)
        const fSel = params.selector.slice(0, i), inner = params.selector.slice(i + FRAME_SEP.length)
        const files = typeof params.files === 'string' ? params.files.split(',').map(f => f.trim()) : params.files
        const chain = `document.querySelector(${JSON.stringify(fSel)})?.contentDocument?.querySelector(${JSON.stringify(inner)})`
        await withDebugger(tabId, async () => {
          await chrome.debugger.sendCommand({ tabId }, 'DOM.enable')
          const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: chain })
          if (!r?.result?.objectId) {
            throw new Error(`upload: file input not found for selector: ${params.selector}` +
              ' (note: cross-origin iframes are not yet supported for upload — tap-core#62)')
          }
          await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { objectId: r.result.objectId, files })
          // same re-dispatch rationale as the top-document path below
          await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: `(() => { const el = ${chain}; if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; } return false; })()`,
            returnByValue: true,
          })
        })
        scheduleDetach(tabId)
        return {}
      }
      // CDP setFileInputFiles — can't be done via chrome.scripting
      const nodeId = await withDebugger(tabId, async () => {
        await chrome.debugger.sendCommand({ tabId }, 'DOM.enable')
        // depth:-1 + pierce so DOM.querySelector resolves deeply-nested / shadow
        // nodes; a shallow getDocument leaves them unknown → setFileInputFiles
        // fails with "Could not find node with given id".
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', { depth: -1, pierce: true })
        const node = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId, selector: params.selector
        })
        if (!node?.nodeId) throw new Error(`upload: file input not found for selector: ${params.selector}`)
        return node.nodeId
      })
      const files = typeof params.files === 'string' ? params.files.split(',').map(f => f.trim()) : params.files
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { nodeId, files })
      // React-synthetic upload components (Ant/rc-upload, mdu) bind onChange via
      // the document-root listener and don't react to the native change that
      // setFileInputFiles fires. Re-dispatch input+change in page context so the
      // component's onChange runs with the now-populated files. Plain inputs
      // (e.g. APK uploader) are unaffected — they just get a harmless extra event.
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(params.selector)}); if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; } return false; })()`,
        returnByValue: true,
      })
      scheduleDetach(tabId)
      return {}
    }

    case 'dialog': {
      // JS override: inject dialog handlers via execFunc — no debugger needed
      const accept = params.accept !== false
      const text = params.prompt_text || ''
      await execFunc(tabId, (doAccept, promptText) => {
        window.alert = () => {}
        window.confirm = () => doAccept
        window.prompt = () => doAccept ? promptText : null
        // Also handle beforeunload
        window.onbeforeunload = null
      }, accept, text)
      return {}
    }

    // ========== INSPECT TOOLS ==========

    case 'inspect.page': {
      const tab = await chrome.tabs.get(tabId)
      const meta = await execFunc(tabId, () => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || '',
        charset: document.characterSet,
        lang: document.documentElement.lang,
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
        og_title: document.querySelector('meta[property="og:title"]')?.content || '',
        viewport_height: window.innerHeight,
        scroll_height: document.documentElement.scrollHeight,
        ready_state: document.readyState,
      })).catch(() => ({}))
      return { url: tab.url, title: tab.title, ...meta }
    }

    case 'inspect.networkStart': {
      // Start capturing network requests via CDP Network domain
      await ensureDebugger(tabId)
      const capture = { entries: [], listening: true, pendingBodies: new Set() }
      networkCaptures.set(tabId, capture)
      requestMeta.set(tabId, new Map())
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable')
      // Clear detach timer — keep debugger alive for capture
      const session = debuggerSessions.get(tabId)
      if (session?.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null }
      // Track in session
      for (const [, s] of sessions) {
        if (s.tabId === tabId) { s.networkCapturing = true; void persistSessions(); break }
      }
      return {}
    }

    case 'inspect.networkDump': {
      const capture = networkCaptures.get(tabId)
      if (!capture) return { entries: [] }
      // Wait briefly for in-flight requests to complete
      await new Promise(r => setTimeout(r, Math.min(params.wait_ms || 500, 3000)))
      // Wait for any in-flight body fetches kicked off by the loadingFinished
      // handler. Bodies are captured eagerly inside the listener (see comment
      // there) — networkDump just awaits the pending promises before returning.
      // The `params.bodies` flag is preserved for backward compat but is now a no-op:
      // bodies are always captured eagerly, regardless of the flag.
      if (capture.pendingBodies.size > 0) {
        await Promise.allSettled([...capture.pendingBodies])
      }
      const entries = capture.entries.filter(e => {
        if (params.url_filter && !e.url?.includes(params.url_filter)) return false
        return true
      })
      return { count: entries.length, entries }
    }

    case 'inspect.networkStop': {
      const cap = networkCaptures.get(tabId)
      if (cap) cap.listening = false
      networkCaptures.delete(tabId)
      requestMeta.delete(tabId)
      try { await chrome.debugger.sendCommand({ tabId }, 'Network.disable') } catch {}
      scheduleDetach(tabId)
      // Track in session
      for (const [, s] of sessions) {
        if (s.tabId === tabId) { s.networkCapturing = false; void persistSessions(); break }
      }
      return {}
    }

    case 'intercept.on': {
      await ensureDebugger(tabId)
      // Patterns must include requestStage:"Request" so we pause BEFORE the
      // request is sent. Without explicit stage, CDP defaults to Request, but
      // being explicit avoids surprise from future CDP changes.
      const patterns = (params.patterns || ['*']).map(p => ({
        urlPattern: p,
        requestStage: 'Request',
      }))
      // Set state BEFORE Fetch.enable so the listener sees it on first paused event
      interceptStates.set(tabId, {
        mode: params.mode === 'abort_writes' ? 'abort_writes' : 'record',
        captured: [],
        listening: true,
      })
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns })
      const session2 = debuggerSessions.get(tabId)
      if (session2?.detachTimer) { clearTimeout(session2.detachTimer); session2.detachTimer = null }
      // Track intercept state in session
      for (const [, s] of sessions) {
        if (s.tabId === tabId) { s.interceptActive = true; void persistSessions(); break }
      }
      return {}
    }

    case 'intercept.off': {
      // Mark listening:false BEFORE Fetch.disable so any in-flight events that
      // arrive after disable but before delete don't get into a weird state.
      const state = interceptStates.get(tabId)
      if (state) state.listening = false
      try { await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable') } catch {}
      interceptStates.delete(tabId)
      scheduleDetach(tabId)
      // Track intercept state in session
      for (const [, s] of sessions) {
        if (s.tabId === tabId) { s.interceptActive = false; void persistSessions(); break }
      }
      return {}
    }

    case 'intercept.dump': {
      const state = interceptStates.get(tabId)
      if (!state) return { count: 0, captured: [] }
      const captured = state.captured.filter(e => {
        if (params.url_filter && !e.url?.includes(params.url_filter)) return false
        if (params.method_filter && String(e.method).toUpperCase() !== String(params.method_filter).toUpperCase()) return false
        return true
      })
      return { count: captured.length, captured }
    }

    // ========== TAB MANAGEMENT ==========

    case 'tab.new': {
      const url = params.url || undefined
      const tab = await chrome.tabs.create(url ? { url, active: false } : { active: false })
      return { tabId: tab.id, url: tab.url || '' }
    }

    case 'tab.list': {
      const tabs = await chrome.tabs.query({})
      return tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }))
    }

    case 'tab.close': {
      const closeId = params.tabId || tabId
      if (closeId) await chrome.tabs.remove(closeId).catch(() => {})
      return {}
    }

    // op:tab — first-class host op (browser-harness management), per
    // tap-core ADR 2026-06-11-op-tab-host-op.md. Sub-dispatches on
    // `action`. Tab-free: operates on explicit tabIds or all tabs, never
    // the session's active tab — so it's in `noTabNeeded`. The legacy
    // tab.new/tab.list/tab.close cases above stay for back-compat.
    case 'tab': {
      const action = params.action
      const ids = Array.isArray(params.tabIds) ? params.tabIds.map(Number) : []
      switch (action) {
        case 'list': {
          const tabs = await chrome.tabs.query({})
          return tabs.map(t => ({
            tabId: t.id,
            url: t.url,
            title: t.title,
            active: t.active,
            pinned: t.pinned,
            groupId: t.groupId,
            windowId: t.windowId,
          }))
        }
        case 'group': {
          if (!ids.length) throw new Error('op:tab action:group requires non-empty tabIds')
          const groupId = await chrome.tabs.group({ tabIds: ids })
          if (params.title !== undefined || params.color !== undefined) {
            const upd = {}
            if (params.title !== undefined) upd.title = String(params.title)
            if (params.color !== undefined) upd.color = String(params.color)
            await chrome.tabGroups.update(groupId, upd)
          }
          return { groupId, tabIds: ids }
        }
        case 'ungroup': {
          if (ids.length) await chrome.tabs.ungroup(ids)
          return { ungrouped: ids }
        }
        case 'close': {
          if (ids.length) await chrome.tabs.remove(ids).catch(() => {})
          return { closed: ids }
        }
        case 'pin':
        case 'unpin': {
          const pinned = action === 'pin'
          const done = []
          for (const id of ids) {
            try { await chrome.tabs.update(id, { pinned }); done.push(id) } catch { /* tab gone */ }
          }
          return { [pinned ? 'pinned' : 'unpinned']: done }
        }
        default:
          throw new Error(`op:tab Unknown action: ${JSON.stringify(action)}`)
      }
    }

    // op:bookmark — first-class host op (bookmark-tree management), per
    // tap-core ADR 2026-06-11-op-bookmark-host-op.md. Sub-dispatches on
    // `action`. Tab-free (operates on chrome.bookmarks node ids) → in
    // `noTabNeeded`. Requires the `bookmarks` manifest permission.
    case 'bookmark': {
      const action = params.action
      switch (action) {
        case 'tree': {
          return await chrome.bookmarks.getTree()
        }
        case 'create': {
          const spec = {}
          if (params.parentId !== undefined) spec.parentId = String(params.parentId)
          if (params.index !== undefined) spec.index = Number(params.index)
          if (params.title !== undefined) spec.title = String(params.title)
          if (params.url !== undefined) spec.url = String(params.url)
          return await chrome.bookmarks.create(spec)
        }
        case 'move': {
          if (params.id === undefined) throw new Error('op:bookmark action:move requires id')
          const dest = {}
          if (params.parentId !== undefined) dest.parentId = String(params.parentId)
          if (params.index !== undefined) dest.index = Number(params.index)
          return await chrome.bookmarks.move(String(params.id), dest)
        }
        case 'update': {
          if (params.id === undefined) throw new Error('op:bookmark action:update requires id')
          const changes = {}
          if (params.title !== undefined) changes.title = String(params.title)
          if (params.url !== undefined) changes.url = String(params.url)
          return await chrome.bookmarks.update(String(params.id), changes)
        }
        case 'remove': {
          if (params.id === undefined) throw new Error('op:bookmark action:remove requires id')
          await chrome.bookmarks.remove(String(params.id))
          return { removed: String(params.id) }
        }
        case 'removeTree': {
          if (params.id === undefined) throw new Error('op:bookmark action:removeTree requires id')
          await chrome.bookmarks.removeTree(String(params.id))
          return { removedTree: String(params.id) }
        }
        default:
          throw new Error(`op:bookmark unknown action: ${JSON.stringify(action)}`)
      }
    }

    // ========== SESSION MANAGEMENT ==========

    case 'session.create': {
      const sessionId = crypto.randomUUID().slice(0, 8)
      // Pick a normal window explicitly. Without windowId, chrome.tabs.create
      // targets the focused window — but Chrome may have zero focused windows
      // when the user is in another app (Claude Code, Slack, etc.), which
      // throws "No current window". Prefer last-focused normal window; fall
      // back to any normal window; create a new one only if zero exist.
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
      let windowId
      if (windows.length === 0) {
        const win = await chrome.windows.create({ focused: false })
        windowId = win.id
      } else {
        try {
          const lf = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
          windowId = lf?.id ?? windows[0].id
        } catch { windowId = windows[0].id }
      }
      const tab = await chrome.tabs.create({ windowId, active: false })
      sessions.set(sessionId, { tabId: tab.id, url: '', interceptActive: false, networkCapturing: false })
      // Await persist: if the SW gets killed between here and the client's
      // next command, storage MUST already contain this session or the tab
      // becomes an orphan on the next SW instance.
      await persistSessions()
      return { sessionId, tabId: tab.id }
    }

    case 'session.destroy': {
      const sid = params.sessionId
      const sess = sessions.get(sid)
      if (!sess) {
        // Session unknown. Expected causes: (1) rare — session created by a
        // previous SW instance that never persisted to storage, (2) benign
        // double-destroy from the client, (3) wrong sid. Return structured
        // reason so the client can log potential orphan tabs instead of
        // silently treating it as success.
        return { closed: false, reason: 'session_not_found' }
      }
      // Ordered cleanup: intercept.off → networkStop → tab.close
      if (sess.interceptActive) {
        try { await handleMethod('intercept.off', { tabId: sess.tabId }, null, { fromDaemon: true }) } catch {}
      }
      if (sess.networkCapturing) {
        try { await handleMethod('inspect.networkStop', { tabId: sess.tabId }, null, { fromDaemon: true }) } catch {}
      }
      await chrome.tabs.remove(sess.tabId).catch(() => {})
      sessions.delete(sid)
      await persistSessions()
      return { closed: true }
    }

    case 'session.info': {
      const sid = params.sessionId
      const sess = sessions.get(sid)
      if (!sess) return { error: 'session not found' }
      return { sessionId: sid, ...sess }
    }

    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

// --- Key Maps ---

const KEY_MAP = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
}

// --- CDP Network Event Listener (for inspect.networkStart/networkDump) ---
//
// LOAD-BEARING DESIGN RULE: capture data inline, never defer.
//
// MV3 service workers go idle between CDP events and user-triggered MCP commands.
// When the SW is idle, Chrome reclaims the debugger session — even though no
// detach was explicit and our debuggerSessions Map still says attached:true.
// Any chrome.debugger.sendCommand call that runs from a user command (rather
// than synchronously from inside an event listener) is at risk of failing with
// "Debugger is not attached to the tab with id: NNNN".
//
// This is why:
//   - HTTP method must come from Network.requestWillBeSent (we cache it in
//     requestMeta), not from Network.responseReceived (which only carries
//     CDP ResourceType).
//   - Request body must come from params.request.postData inline (Chrome
//     inlines it for payloads at least 640KB), not from a deferred
//     Network.getRequestPostData call.
//   - Response body must be fetched inside the Network.loadingFinished
//     handler, not later from inspect.networkDump's body-fetch loop.
//     (That loop existed for years and silently failed on every call —
//     its catch block was eating "Debugger is not attached" errors.)
//
// Don't defer CDP work to a separate command. Capture eagerly inside the
// listener, store on the entry / in requestMeta, let networkDump just read.

// RC4 (2026-06-11 weixin dogfood): native JS dialogs (alert/confirm/prompt/
// beforeunload) are NOT page DOM — no op can dismiss them, so an unhandled one
// hangs the op until the relay socket times out (~3.5min on the dirty self-menu
// editor's "Leave site?"). With the Page domain enabled on every debugger attach
// (ensureDebugger), auto-handle them at the CDP layer. Policy: ACCEPT
// beforeunload (we navigate on purpose → leave) + alert (informational); DISMISS
// confirm + prompt (cancel is the safe default — never auto-confirm a
// destructive "确定删除?" the agent did not intend). Complements P0b, which
// suppresses the beforeunload on the nav path (no debugger attached there).
async function handleDialogEvent(source, method, params) {
  if (method !== 'Page.javascriptDialogOpening') return
  const accept = params?.type === 'beforeunload' || params?.type === 'alert'
  try {
    await chrome.debugger.sendCommand({ tabId: source.tabId }, 'Page.handleJavaScriptDialog', { accept })
  } catch { /* dialog already gone (navigation / debugger detach) */ }
}
chrome.debugger.onEvent.addListener(handleDialogEvent)

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  const capture = networkCaptures.get(tabId)
  if (!capture?.listening) return

  if (method === 'Network.requestWillBeSent') {
    let metaMap = requestMeta.get(tabId)
    if (!metaMap) { metaMap = new Map(); requestMeta.set(tabId, metaMap) }
    metaMap.set(params.requestId, {
      method: params.request?.method || 'GET',
      url: params.request?.url || '',
      hasPostData: params.request?.hasPostData || false,
      postData: params.request?.postData || null,
    })
    return
  }

  if (method === 'Network.loadingFinished') {
    const entry = capture.entries.find(e => e.requestId === params.requestId)
    if (entry && entry.responseBody === undefined) {
      // Eager body fetch — must run inside this handler, see top comment.
      // Track the promise so networkDump can await it before returning.
      const p = chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: params.requestId })
        .then(body => { entry.responseBody = body?.body?.substring(0, 10000) || '' })
        .catch(e => { entry.responseBodyError = String(e?.message || e) })
        .finally(() => { capture.pendingBodies.delete(p) })
      capture.pendingBodies.add(p)
    }
    requestMeta.get(tabId)?.delete(params.requestId)
    return
  }

  if (method === 'Network.loadingFailed') {
    requestMeta.get(tabId)?.delete(params.requestId)
    return
  }

  if (method === 'Network.responseReceived') {
    const { response, requestId } = params
    if (!response?.url) return
    // Only capture API-like requests (JSON, XHR, fetch)
    const ct = response.headers?.['content-type'] || response.headers?.['Content-Type'] || ''
    const isApi = ct.includes('json') || ct.includes('xml') || response.mimeType?.includes('json')
    const isDoc = ct.includes('html') || ct.includes('css') || ct.includes('javascript') || ct.includes('image') || ct.includes('font')
    if (isDoc && !isApi) return
    // Merge in HTTP method + inline post data from the meta map (captured at requestWillBeSent).
    const meta = requestMeta.get(tabId)?.get(requestId)
    capture.entries.push({
      url: response.url,
      method: meta?.method || 'GET',           // Real HTTP method from requestWillBeSent
      resourceType: params.type,               // CDP ResourceType — kept separately for diagnostics
      hasPostData: meta?.hasPostData || false,
      requestBody: meta?.postData || undefined, // Inline body, undefined for GETs and >~640KB POSTs
      status: response.status,
      type: response.mimeType || ct.split(';')[0],
      requestId,
    })
  }
})

// --- CDP Fetch Domain Listener (for intercept.on / abort_writes mode — Phase B) ---
//
// Separate from the Network listener above because:
//   1. Fetch.requestPaused MUST always call continueRequest or failRequest,
//      otherwise the page hangs. The Network listener can early-return on
//      irrelevant events; the Fetch listener cannot.
//   2. interceptStates and networkCaptures are independent — a tab can have
//      one without the other (e.g., probe_actions enables intercept without
//      network capture).
//
// Same load-bearing rule as the Network listener: all CDP work happens
// synchronously inside this handler. The MV3 SW idle constraint means
// chrome.debugger.sendCommand calls deferred to a later command will fail
// with "Debugger is not attached". Inside this handler, the debugger is
// guaranteed attached because the event delivery itself proves it.
//
// The async handler is fine in MV3 — Chrome keeps the SW alive while a
// listener promise is pending, which is exactly when we're awaiting CDP.

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (method !== 'Fetch.requestPaused') return
  const tabId = source.tabId
  const state = interceptStates.get(tabId)

  // Defensive: if no state (intercept.off race or stale event), unblock the
  // request rather than letting it hang. This should be rare but the cost of
  // a hang is much worse than the cost of an extra continueRequest call.
  if (!state?.listening) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', {
        requestId: params.requestId,
      })
    } catch { /* request may have been canceled by page navigation */ }
    return
  }

  const { requestId, request } = params
  const httpMethod = String(request?.method || 'GET').toUpperCase()
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod)

  // Capture metadata BEFORE deciding what to do — record both kept and
  // aborted requests so the caller can see what was probed.
  state.captured.push({
    url: request?.url || '',
    method: httpMethod,
    headers: request?.headers || {},
    body: request?.postData || null,
    timestamp: Date.now(),
    action: state.mode === 'abort_writes' && isWrite ? 'aborted' : 'continued',
  })

  // Decide
  if (state.mode === 'abort_writes' && isWrite) {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.failRequest', {
        requestId,
        errorReason: 'Aborted',
      })
    } catch (e) {
      // failRequest can fail if the page navigated away mid-request.
      // Try a fallback continue to avoid leaving the request hung.
      console.warn('[tap] Fetch.failRequest failed, falling back to continue:', e?.message)
      try { await chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId }) } catch {}
    }
    return
  }

  // record mode (default) — let it through
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Fetch.continueRequest', { requestId })
  } catch (e) {
    console.warn('[tap] Fetch.continueRequest failed:', e?.message)
  }
})

// --- HTTP Polling to Daemon ---

const DAEMON_URL = 'http://127.0.0.1:9333'
// Unique session ID — daemon uses this to evict ghost polls from old service workers
const SESSION_ID = crypto.randomUUID()

// Badge: show connection status on extension icon
let connected = false
function setBadge(ok) {
  connected = ok
  chrome.action.setBadgeText({ text: ok ? '' : '!' })
  if (!ok) chrome.action.setBadgeBackgroundColor({ color: '#EF4444' })
  // User-facing string says "bridge", not "daemon" (CLAUDE.md vocab rule).
  chrome.action.setTitle({ title: ok ? 'Tap — connected' : 'Tap — bridge not running' })
}

// Icon click is owned by the popup (manifest.action.default_popup) —
// chrome.action.onClicked never fires while default_popup is set, so the
// previous "open install URL on click" handler was dead code. The popup
// surfaces bridge status, the per-failure-mode recovery CTA, and the
// install link when first-time setup is required.

// ─── Native messaging transport (ADR 2026-05-14-host-as-daemon.md) ─
//
// SUPERSEDES ADR 2026-05-05-daemon-sw-via-websocket.md and the
// short-lived 2026-05-13-daemon-extension-via-native-messaging.md
// (host-as-byte-forwarder model). Per the 2026-05-14 T4-final
// refactor, the NM host IS the dispatch core — there is no separate
// daemon process. The Chrome SW calls
// chrome.runtime.connectNative("dev.taprun.daemon"), which spawns
// the tap binary; the binary detects its argv[0]=chrome-extension://
// invocation and routes into core/native-messaging/host.ts which
// binds ~/.tap/host.sock for CLI conns and serves dispatch directly.
//
// NATIVE_HOST_NAME below MUST equal core/native-messaging/extension_id.ts's
// NATIVE_HOST_NAME export. Drift = silent NM handshake failure.
// Architecture test `N9` (core/src/test/architecture_native_messaging_
// test.ts) reads this literal and asserts equality with the Deno-side
// constant; the test fails the build before any release ships with a
// mismatch. The literal still carries ".daemon" suffix for the
// historical reason explained in extension_id.ts — renaming would
// require atomic CLI+extension release, which is impossible across
// CWS auto-update + brew upgrade cadence.
//
// Key properties (PoC 2026-05-13 validated, see core/core-experiments/
// native-messaging-poc/):
//   T1 — port keeps SW alive >19min idle with zero traffic
//        (no alarm/keepalive needed)
//   T2 — SW force-kill → host EOF detection in ~2ms
//        (OS pipe close, not heuristic timer)
//   T3 — Chrome quit → graceful EOF
//        (clean disconnect, no zombie state)
//
// Wire envelope unchanged — JSON-RPC 2.0 per ADR 2026-05-05 §2.
// What changes: transport is OS pipe (via Port) instead of WebSocket.
// What stays the same: WIRE_CODE table, dispatch handler, cleanup_tabs
// notification semantics.

// JSON-RPC error code map (mirrors core/wire-codes.ts WIRE_CODE).
// Drift caught by: `public/extension/test/wire_codes.test.mjs`.
const WIRE_CODE = {
  missing_runtime_declaration: -32000,
  peer_not_registered: -32001,
  unsupported_op_for_peer: -32002,
  peer_unreachable: -32003,
  // -32015 fetch_network (DNS / connection refused / TLS / timeout — the
  // layer below HTTP) added per ADR 2026-05-22-unify-verify-with-runtime
  // slice 2. Mirrors core/core/wire-codes.ts; the W4 drift-guard keeps
  // them in lockstep (was missing here until 2026-05-30).
  fetch_network: -32015,
  fetch_http: -32004,
  fetch_parse: -32005,
  navigation_blocked: -32006,
  selector_not_found: -32007,
  tab_closed: -32008,
  csp_violation: -32009,
  permission_denied: -32010,
  secret_unresolved: -32011,
  timeout: -32012,
  wire_kind_unknown: -32013,
  tap_drifted: -32014,
  // -32016: op:eval page-context JS exception (tap-core#65). Op-level abort
  // (the page threw), NOT peer-transport — keeps it off the misleading
  // reconnect_extension recovery hint. Mirrors core/core/wire-codes.ts; W4
  // drift-guard keeps them in lockstep.
  eval_error: -32016,
}

const NATIVE_HOST_NAME = 'dev.taprun.daemon'
let port = undefined
// Last disconnect reason from chrome.runtime.lastError — surfaced to
// popup so the UI can show a specific CTA per failure mode:
//   "Specified native messaging host not found" → manifest missing
//   "Native host has exited"                    → daemon down / host crash
//   "...is forbidden"                            → Chrome blocklist / allowed_origins
//   ""                                            → never tried / initial
let lastDisconnectReason = ''
// B1 (ADR 2026-05-30-bind-host-lifetime-to-nm-port §5): set when the host
// we just spawned signalled `host_unavailable / already_running` — another
// Chrome profile owns the singleton bridge. Lets onDisconnect surface the
// honest "another profile owns the bridge" reason instead of Chrome's
// generic "Native host has exited", so the popup stops crying wolf.
let bridgeOwnedElsewhere = false

function connectBridge() {
  if (port) return  // already connected — Port is held by SW, persists until close
  bridgeOwnedElsewhere = false  // reset per connect attempt
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  } catch (e) {
    lastDisconnectReason = (e && e.message) || String(e)
    console.log('[tap-nm] connectNative threw:', lastDisconnectReason)
    setBadge(false)
    return
  }
  console.log('[tap-nm] port opened to', NATIVE_HOST_NAME)
  lastDisconnectReason = ''
  setBadge(true)

  port.onMessage.addListener(async (msg) => {
    // Chrome Native Messaging delivers the parsed object directly —
    // no JSON.parse needed (unlike ws.onmessage with e.data).
    if (!msg || msg.jsonrpc !== '2.0') return

    // ─── Notification: host_unavailable (B1) ──────────────────────────
    // Per ADR 2026-05-30-bind-host-lifetime-to-nm-port §5: the host we
    // just spawned lost the singleton lock — another Chrome profile owns
    // the bridge. It sends this one frame right before exiting 0. Record
    // the honest reason so the imminent onDisconnect surfaces it (and the
    // popup shows "another profile owns the bridge", not red "Bridge not
    // running"). The bridge IS available — just not to this profile.
    if (msg.method === 'host_unavailable' && (msg.id === undefined || msg.id === null)) {
      const reason = (msg.params && msg.params.reason) || 'unavailable'
      if (reason === 'already_running') {
        bridgeOwnedElsewhere = true
        const owner = msg.params && msg.params.owner_pid
        lastDisconnectReason = 'host_already_running' + (owner ? ` (owner pid ${owner})` : '')
        console.log('[tap-nm] another Chrome profile owns the bridge', owner ? `(pid ${owner})` : '')
      }
      return
    }

    // ─── Notification: cleanup_tabs ───────────────────────────────────
    // Per ADR 2026-05-10-plan-lifecycle-scoped-tabs: daemon sends
    //   {jsonrpc:"2.0", method:"cleanup_tabs", params:{sessionId, tabIds:[...]}}
    // (notification — no id) when a Run with lifecycle:"scoped" (the
    // RAII default) terminates. We close each tracked tab errorTolerant
    // — if the user already closed it, chrome.tabs.remove rejects, we
    // discard (race per ADR §6.4). Pre-existing tabs not in tabIds are
    // untouched (per ADR §6.2).
    if (msg.method === 'cleanup_tabs' && (msg.id === undefined || msg.id === null)) {
      const tabIds = (msg.params && Array.isArray(msg.params.tabIds)) ? msg.params.tabIds : []
      for (const tabId of tabIds) {
        try { await chrome.tabs.remove(tabId) } catch { /* race: tab already closed */ }
      }
      return
    }

    if (msg.id === undefined || msg.id === null || typeof msg.method !== 'string') return
    // JSON-RPC request: {id, method:"dispatch", params:{op, sessionId?}}
    if (msg.method !== 'dispatch') return
    const params = msg.params || {}
    const op = params.op || {}
    const { op: opName, ...rest } = op
    const method = String(opName).replace(/^tap\./, '')
    const resolvedParams = { ...rest }
    // ─── Per-op shape guard (tap-core#59 P0-A) ─────────────────────────────
    // Mirror of core/assets/plan-v1.schema.json per-op `required` arrays
    // (besides discriminator `op`). On missing required field, return a
    // typed JSON-RPC -32602 (Invalid params) error BEFORE handleMethod, so
    // `undefined` never leaks into the handler and surfaces as the
    // user-baffling "empty SW reply" failure mode that cost 30min on
    // 2026-05-18. Drift-guarded by extension/test/op-shape-validation.test.mjs.
    const OP_REQUIRED_FIELDS = {
      fetch: ['url'],
      nav: ['url'],
      input: ['kind'],
      extract: ['root', 'per_item'],
      tap: ['site', 'name'],
      eval: ['fn', 'returns'],
      tab: ['action'],
      bookmark: ['action'],
    }
    const required = OP_REQUIRED_FIELDS[method] || []
    const missing = required.filter((k) => resolvedParams[k] === undefined)
    if (missing.length > 0) {
      const errResp = {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32602,
          message: `Invalid params: op:${method} missing required field(s): ${missing.join(', ')}`,
        },
      }
      try { port.postMessage(errResp) } catch { /* port gone */ }
      return
    }
    // Engine-side EvalOp uses `fn`; extension's handleMethod historically
    // reads `params.expression`. Translate here so we don't have to fork
    // the type. Safe because the guard above guarantees `fn` is present.
    //
    // op.args (engine-resolved positional values; the engine already
    // interpolated {{...}} as DATA in core/dispatch.ts:engineEval) are
    // applied to the fn so authors pass run-time values WITHOUT baking
    // them into the code string. JSON.stringify is the safe data→JS-literal
    // serialization (escapes quotes/newlines/unicode); the values are
    // already-resolved data, not user code. Absent args → `apply(null, [])`
    // ≡ `()`, so existing zero-arg eval plans are unchanged.
    if (method === 'eval' && resolvedParams.fn !== undefined && resolvedParams.expression === undefined) {
      const argsLit = JSON.stringify(Array.isArray(resolvedParams.args) ? resolvedParams.args : [])
      resolvedParams.expression = `(${resolvedParams.fn}).apply(null, ${argsLit})`
    }
    if (params.sessionId) {
      resolvedParams._sessionId = params.sessionId
      if (sessions.has(params.sessionId)) {
        resolvedParams.tabId = sessions.get(params.sessionId).tabId
      }
    }
    let response
    try {
      const result = await handleMethod(method, resolvedParams, null, { fromDaemon: true })
      response = { jsonrpc: '2.0', id: msg.id, result }
    } catch (error) {
      const errMsg = (error && error.message) || String(error)
      response = {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: classifyExtensionError(errMsg, method),
          message: errMsg,
        },
      }
    }
    try { port.postMessage(response) } catch { /* port gone */ }
  })

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError
    // Preserve the specific host_already_running reason if the host
    // signalled it just before exiting (B1); otherwise Chrome's generic
    // lastError ("Native host has exited") is the best we have.
    if (!bridgeOwnedElsewhere) {
      lastDisconnectReason = (err && err.message) || '(no error)'
    }
    console.log('[tap-nm] port disconnected:', lastDisconnectReason)
    port = undefined
    setBadge(false)
    // No reconnect timer. Either:
    //   - daemon stopped → next user action (which spawns a fresh SW
    //     instance via any chrome API call) re-runs top-level
    //     connectBridge() below.
    //   - host crashed → Chrome's anti-DoS blocklist would activate on
    //     repeated crashes anyway; a tight reconnect loop would just
    //     accelerate that.
    //   - another profile owns the bridge (bridgeOwnedElsewhere) → the
    //     loser host clean-exits in <50ms (not a crash, no blocklist
    //     pressure). A wake-driven reconnect is harmless and self-heals
    //     the moment the owning profile closes; meanwhile the popup shows
    //     the honest "another profile owns the bridge" CTA, not red.
    // The next legitimate SW spawn (user action / browser restart)
    // re-establishes the bridge.
  })
}

// Classify extension-side error string into a JSON-RPC code via
// WIRE_CODE. Covers the common cases the SW's handleMethod can throw;
// unknown shapes default to peer_unreachable (back-compat).
function classifyExtensionError(msg, method) {
  const s = String(msg || '').toLowerCase()
  if (s.includes('http_error') || /\bstatus[:=]\s*[45]\d\d/.test(s)) {
    return WIRE_CODE.fetch_http
  }
  if (s.includes('selector') && (s.includes('not found') || s.includes('not_found'))) {
    return WIRE_CODE.selector_not_found
  }
  if (s.includes('navigation') && s.includes('block')) {
    return WIRE_CODE.navigation_blocked
  }
  if (s.includes('tab') && (s.includes('closed') || s.includes('no longer'))) {
    return WIRE_CODE.tab_closed
  }
  if (s.includes('timeout') || s.includes('timed out')) {
    return WIRE_CODE.timeout
  }
  if (s.includes('csp') || s.includes('content security policy')) {
    return WIRE_CODE.csp_violation
  }
  if (s.includes('permission')) {
    return WIRE_CODE.permission_denied
  }
  // op:eval page-context exceptions (a throw inside the fn — TypeError,
  // ReferenceError, a bad-shape return, …) RAN on the substrate and the PAGE
  // threw: an op-level abort, not the peer being unreachable. Pre-#65 these
  // fell through to peer_unreachable below and mis-routed to the misleading
  // reconnect_extension recovery hint, burying the real script bug. Gated on
  // method==='eval' so a stray "TypeError: Failed to fetch" from another op
  // is not swept up here. (tap-core#65)
  if (method === 'eval') {
    return WIRE_CODE.eval_error
  }
  return WIRE_CODE.peer_unreachable
}

// Per ADR 2026-05-10-saa-page-session-fetch-cross-repo: the prior
// chrome.tabs.onActivated → active_tab_changed forwarder is deleted.
// Daemon's lastActiveTab cache was deleted by parent SAA ADR; tab
// routing flows through sessionId/sessions[] only.

// Connect the native-messaging bridge on SW spawn. Per ADR 2026-05-13:
// the Port itself keeps the SW alive (PoC T1: >19 min idle with 0
// traffic). No keepalive alarm needed; no wake hooks needed; the next
// SW respawn (browser restart, user action) re-runs this line.
connectBridge()
