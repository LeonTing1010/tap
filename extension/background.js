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
// command routing (pollLoop) must await this before doing any work.
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
      return
    }
    throw e
  }
}

async function withDebugger(tabId, fn) {
  await ensureDebugger(tabId)
  try { return await fn() }
  finally { scheduleDetach(tabId) }
}

async function cdpClick(tabId, x, y) {
  await withDebugger(tabId, async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    })
  })
}

// --- Navigation Helper ---

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

async function execFunc(tabId, func, ...args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, func, args, world: 'MAIN'
  })
  return result?.result
}

// --- Message Handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  // Methods that can work without a tab
  const noTabNeeded = ['nav', 'tab.new', 'tab.list', 'tab.close', 'capabilities', 'reload',
                       'session.create', 'session.destroy', 'session.info']
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
      // Resolve current tab state. If the session's tab was closed behind our
      // back, chrome.tabs.get throws — fall through to "create new tab" and
      // rebind to the sessionId below (self-heal path).
      let current = null
      if (tabId) {
        try { current = await chrome.tabs.get(tabId) }
        catch { tabId = null }
      }
      if (!tabId) {
        const tab = await chrome.tabs.create({ url: params.url, active: false })
        tabId = tab.id
      } else {
        const isInternal = current.url?.startsWith('chrome://') || current.url?.startsWith('data:')
        if (isInternal && !fromDaemon) {
          // Popup/content-script path: the user is actively looking at a
          // chrome:// or data: tab — don't clobber it, open the target in a
          // new tab instead. This is UX-preserving replacement.
          const tab = await chrome.tabs.create({ url: params.url, active: false })
          tabId = tab.id
        } else {
          // Daemon path (and regular-URL tabs): navigate in place via
          // tabs.update. chrome://newtab/ is our own placeholder from
          // session.create and can be navigated away from in place — the
          // previous "create a replacement tab" branch leaked the original
          // chrome://newtab/ on every session-based nav.
          await chrome.tabs.update(tabId, { url: params.url })
        }
      }
      await waitForTabLoad(tabId, params.url)
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
      const sid = params._sessionId
      if (!sessionUpdated && fromDaemon && sid && !sessions.has(sid)) {
        sessions.set(sid, {
          tabId, url: finalTab.url || params.url,
          interceptActive: false, networkCapturing: false,
        })
        sessionUpdated = true
      }
      if (sessionUpdated) void persistSessions()
      return { frameId: 'main', tabId, url: finalTab.url || params.url }
    }

    case 'wait':
      await new Promise(r => setTimeout(r, Math.min(params.ms, 25000)))
      return {}

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
          'click', 'type', 'fill', 'hover', 'scroll', 'pressKey', 'select',
          'fetch', 'find', 'download', 'waitFor', 'waitForNetwork', 'ssrState', 'copyAll',
          'upload', 'dialog', 'extract',
          'tab.new', 'tab.list', 'tab.close',
          'inspect.page', 'inspect.networkStart', 'inspect.networkDump', 'inspect.networkStop',
          'intercept.on', 'intercept.off',
          'session.create', 'session.destroy', 'session.info'
        ]
      }

    // ========== BUILT-IN (17) — chrome.scripting func injection, zero CSP issues ==========

    case 'click': {
      const target = (params.target || params.selector)
      // JS-first: use el.click() via execFunc — no debugger, no yellow bar, CSP-immune
      const result = await execFunc(tabId, (t) => {
        let el = document.querySelector(t)
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
      }, target)
      // CDP fallback: if site needs isTrusted events, retry with cdpClick
      if (params.trusted) {
        await cdpClick(tabId, result.x, result.y)
      }
      return {}
    }

    case 'type': {
      const { selector, text } = params
      const mode = await execFunc(tabId, (sel, txt) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
            : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          if (setter) setter.call(el, txt); else el.value = txt
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return 'done'
        }
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, selector, text)
      if (mode !== 'done') {
        await cdpClick(tabId, mode.x, mode.y)
        await handleMethod('keyboard', { key: 'a', action: 'press', modifiers: 4 })
        await handleMethod('keyboard', { key: text, action: 'type' })
      }
      return {}
    }

    case 'fill': {
      const { selector, text } = params
      await execFunc(tabId, (sel, txt) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.focus()
        const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
          : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (setter) setter.call(el, txt); else el.value = txt
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, selector, text)
      return {}
    }

    case 'hover': {
      const coords = await execFunc(tabId, (sel) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, params.selector)
      await withDebugger(tabId, () =>
        chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x, y: coords.y }))
      return {}
    }

    case 'scroll':
      await execFunc(tabId, (sel) => {
        const el = sel ? document.querySelector(sel) : null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        else window.scrollBy({ top: 500, behavior: 'smooth' })
      }, params.selector || '')
      return {}

    case 'pressKey':
      return handleMethod('keyboard', { key: params.key, action: 'press', modifiers: params.modifiers || 0 })

    case 'select':
      await execFunc(tabId, (sel, val) => {
        const el = document.querySelector(sel)
        if (!el) throw new Error('Element not found: ' + sel)
        el.value = val
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, params.selector, params.value)
      return {}

    case 'fetch': {
      const { url, ...opts } = params
      return await execFunc(tabId, async (u, o) => {
        const res = await fetch(u, { credentials: 'include', ...o })
        return res.json()
      }, url, opts)
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
      const sel = params.selector
      const fields = params.fields
      return await execFunc(tabId, (rowSel, fieldMap) => {
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
      // CDP setFileInputFiles — can't be done via chrome.scripting
      const nodeId = await withDebugger(tabId, async () => {
        await chrome.debugger.sendCommand({ tabId }, 'DOM.enable')
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument')
        const node = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId, selector: params.selector
        })
        return node.nodeId
      })
      const files = typeof params.files === 'string' ? params.files.split(',').map(f => f.trim()) : params.files
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', { nodeId, files })
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
  chrome.action.setTitle({ title: ok ? 'Tap — connected' : 'Tap — disconnected (daemon not running)' })
}

// Click icon: open install guide if disconnected, otherwise no-op
chrome.action.onClicked.addListener(async () => {
  if (connected) return
  // Disconnected — open install guide so user knows what to do
  chrome.tabs.create({ url: 'https://taprun.dev/install?utm_source=chrome-ext&utm_medium=extension&utm_campaign=icon-click' })
  // Use startPoll (not pollLoop directly) so rehydrate always runs first.
  startPoll()
})

// Keep-alive: MV3 kills service workers after ~30s idle.
// chrome.alarms wakes us every 1min (Chrome minimum) to restart pollLoop.
let polling = false
chrome.alarms.create('keepalive', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => {
  if (!polling) {
    console.log('[tap] alarm woke service worker — restarting pollLoop')
    startPoll()
  }
})

// Handle a command from daemon and send result back — runs concurrently with poll loop.
// fromDaemon=true: commands use explicit tabId (or sessionId→tabId), no auto-discover.
// This prevents cross-session tab leakage when multiple MCP sessions share the daemon.
async function handleAndReport(id, method, params) {
  let response
  try {
    const result = await handleMethod(method, params, null, { fromDaemon: true })
    response = { id, result }
  } catch (error) {
    const msg = error.message || ''
    response = { id, error: { code: -32000, message: msg } }
  }
  try {
    await fetch(`${DAEMON_URL}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    })
  } catch { /* daemon gone — next poll will reconnect */ }
}

function startPoll() {
  if (polling) return
  polling = true
  // Wait for rehydrate before accepting commands — otherwise the poll loop
  // would resolve sessionId→tabId against an empty Map right after SW wake,
  // routing commands to nothing and throwing "No active tab".
  rehydrateReady.finally(() => pollLoop())
}

async function pollLoop() {
  console.log('[tap] long-poll loop started, daemon:', DAEMON_URL)
  let backoff = 3000
  while (true) {
    let res
    try {
      // Long-poll: daemon holds connection until a command arrives (up to 20s)
      // Explicit 25s timeout — prevents indefinite hang that kills service worker
      res = await fetch(`${DAEMON_URL}/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID }),
        signal: AbortSignal.timeout(25000),
      })
    } catch (e) {
      if (e?.name === 'TimeoutError') {
        // AbortSignal timeout — daemon is alive but slow, just re-poll immediately
        backoff = 3000
        continue
      }
      // Daemon not running — badge + exponential backoff + retry (don't exit loop)
      setBadge(false)
      await new Promise(r => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 60000)
      continue
    }
    backoff = 3000  // successful connection — reset backoff

    try {
      const body = await res.json()
      const commands = body.commands || []
      setBadge(true)

      // Process commands concurrently — don't block the poll loop.
      // If we await handleMethod here, there's no active fetch during
      // command execution, and Chrome kills the service worker.
      for (const cmd of commands) {
        const { id, method: rawMethod, params, sessionId } = cmd
        const method = rawMethod?.replace?.('tap.', '') || rawMethod
        const resolvedParams = { ...(params || {}) }
        // Resolve sessionId to tabId. Always pass _sessionId through so nav can
        // auto-heal when the session's tab was closed behind our back (user
        // close / Chrome replace / SW missed the onRemoved event): nav creates
        // a fresh tab and rebinds it to the original sessionId. Without this,
        // the next command hits "No active tab" forever.
        if (sessionId) {
          resolvedParams._sessionId = sessionId
          if (sessions.has(sessionId)) {
            resolvedParams.tabId = sessions.get(sessionId).tabId
          }
        }

        // Fire-and-forget: handle + report result asynchronously
        handleAndReport(id, method, resolvedParams)
      }
    } catch {
      // Bad response — retry
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

startPoll()
