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

let activeTabId = null
const debuggerSessions = new Map()

// Network capture state (per-tab)
const networkCaptures = new Map() // tabId → { entries: [], listening: boolean }

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) clearTimeout(session.detachTimer)
  debuggerSessions.delete(tabId)
  networkCaptures.delete(tabId)
  if (tabId === activeTabId) activeTabId = null
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

// --- Tab Resolution ---

async function resolveTab(params, { allowUnscriptable = false, fromDaemon = false } = {}) {
  const explicitTabId = params.tabId ? Number(params.tabId) : null
  // Daemon commands: ONLY use explicit tabId — never fall back to activeTabId.
  // This prevents cross-session tab leakage when multiple MCP sessions share the daemon.
  // activeTabId is only for popup/content-script messages (single-user, no session).
  let tabId = fromDaemon ? explicitTabId : (explicitTabId || activeTabId)

  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId)
      // Skip chrome:// tabs — can't run scripts on them (unless caller handles it, e.g. nav)
      if (!allowUnscriptable && (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://'))) {
        if (explicitTabId || fromDaemon) throw new Error(`Tab ${tabId} is not scriptable (${tab.url})`)
        tabId = null
      }
    } catch (e) {
      if (explicitTabId || fromDaemon) throw e
      tabId = null
    }
  }

  // Auto-discover: only for non-daemon callers (popup, content script)
  // Daemon sessions return null — handleMethod decides if that's an error
  // (nav and tab.new can work without a tab, other methods cannot)
  if (!tabId) {
    if (fromDaemon) return null
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const httpTab = tabs.find(t => t.url?.startsWith('http'))
    if (httpTab) {
      tabId = httpTab.id
    } else {
      const tab = await chrome.tabs.create({ active: false })
      tabId = tab.id
    }
    activeTabId = tabId
  }
  return tabId
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
  // nav and tab.close don't need to script the tab — let chrome:// tabs through
  const allowUnscriptable = method === 'nav' || method === 'tab.close'
  let tabId = await resolveTab(params, { allowUnscriptable, fromDaemon })

  // nav and tab.new can work without an existing tab — they create one
  if (!tabId && method !== 'nav' && method !== 'tab.new' && method !== 'tab.list' && method !== 'capabilities') {
    throw new Error('No active tab. Call nav first to open a page.')
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
      if (!tabId) {
        // No tab exists yet — create one with the target URL (background, don't steal focus)
        const tab = await chrome.tabs.create({ url: params.url, active: false })
        tabId = tab.id
        activeTabId = tab.id
      } else {
        const current = await chrome.tabs.get(tabId)
        if (current.url?.startsWith('chrome://') || current.url?.startsWith('data:')) {
          const tab = await chrome.tabs.create({ url: params.url, active: false })
          tabId = tab.id
          activeTabId = tab.id
        } else {
          await chrome.tabs.update(tabId, { url: params.url })
          activeTabId = tabId
        }
      }
      await waitForTabLoad(activeTabId, params.url)
      // Return final URL (after redirects) — session URL tracking depends on this
      const finalTab = await chrome.tabs.get(activeTabId)
      return { frameId: 'main', tabId: activeTabId, url: finalTab.url || params.url }
    }

    case 'wait':
      await new Promise(r => setTimeout(r, Math.min(params.ms, 25000)))
      return {}

    case 'screenshot': {
      const fmt = params.format || 'jpeg'
      const quality = params.quality ?? 50
      const data = await withDebugger(tabId, async () => {
        const result = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
          format: fmt, quality,
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
          'intercept.on', 'intercept.off'
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
      const capture = { entries: [], listening: true }
      networkCaptures.set(tabId, capture)
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable')
      // Clear detach timer — keep debugger alive for capture
      const session = debuggerSessions.get(tabId)
      if (session?.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null }
      return {}
    }

    case 'inspect.networkDump': {
      const capture = networkCaptures.get(tabId)
      if (!capture) return { entries: [] }
      // Wait briefly for in-flight requests to complete
      await new Promise(r => setTimeout(r, Math.min(params.wait_ms || 500, 3000)))
      const entries = capture.entries.filter(e => {
        if (params.url_filter && !e.url?.includes(params.url_filter)) return false
        return true
      })
      // Optionally fetch response bodies
      if (params.bodies) {
        for (const entry of entries) {
          if (!entry.requestId || entry.responseBody !== undefined) continue
          try {
            const body = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId: entry.requestId })
            entry.responseBody = body?.body?.substring(0, 10000) || ''
          } catch { /* body not available */ }
        }
      }
      return { count: entries.length, entries }
    }

    case 'inspect.networkStop': {
      const cap = networkCaptures.get(tabId)
      if (cap) cap.listening = false
      networkCaptures.delete(tabId)
      try { await chrome.debugger.sendCommand({ tabId }, 'Network.disable') } catch {}
      scheduleDetach(tabId)
      return {}
    }

    case 'intercept.on': {
      await ensureDebugger(tabId)
      const patterns = (params.patterns || ['*']).map(p => ({ urlPattern: p }))
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', { patterns })
      const session2 = debuggerSessions.get(tabId)
      if (session2?.detachTimer) { clearTimeout(session2.detachTimer); session2.detachTimer = null }
      return {}
    }

    case 'intercept.off': {
      try { await chrome.debugger.sendCommand({ tabId }, 'Fetch.disable') } catch {}
      scheduleDetach(tabId)
      return {}
    }

    // ========== TAB MANAGEMENT ==========

    case 'tab.new': {
      const url = params.url || undefined
      const tab = await chrome.tabs.create(url ? { url, active: false } : { active: false })
      activeTabId = tab.id
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

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  const capture = networkCaptures.get(tabId)
  if (!capture?.listening) return

  if (method === 'Network.responseReceived') {
    const { response, requestId } = params
    if (!response?.url) return
    // Only capture API-like requests (JSON, XHR, fetch)
    const ct = response.headers?.['content-type'] || response.headers?.['Content-Type'] || ''
    const isApi = ct.includes('json') || ct.includes('xml') || response.mimeType?.includes('json')
    const isDoc = ct.includes('html') || ct.includes('css') || ct.includes('javascript') || ct.includes('image') || ct.includes('font')
    if (isDoc && !isApi) return
    capture.entries.push({
      url: response.url,
      method: params.type || 'GET',
      status: response.status,
      type: response.mimeType || ct.split(';')[0],
      requestId,
    })
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

// Click icon: show status or reconnect
chrome.action.onClicked.addListener(async () => {
  if (connected) return
  // Disconnected — try immediate reconnect
  setBadge(false)
  if (!polling) pollLoop()
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
// fromDaemon=true: commands ONLY use explicit tabId, never activeTabId fallback.
// This prevents cross-session tab leakage when multiple MCP sessions share the daemon.
async function handleAndReport(id, method, params) {
  let response
  try {
    const result = await handleMethod(method, params, null, { fromDaemon: true })
    response = { id, result }
  } catch (error) {
    console.error(`[tap] ${method}:`, error.message)
    response = { id, error: { code: -32000, message: error.message } }
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
  pollLoop()
}

async function pollLoop() {
  console.log('[tap] long-poll loop started, daemon:', DAEMON_URL)
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
        continue
      }
      // Daemon not running — badge + backoff + retry (don't exit loop)
      setBadge(false)
      await new Promise(r => setTimeout(r, 3000))
      continue
    }

    try {
      const body = await res.json()
      const commands = body.commands || []
      setBadge(true)

      // Process commands concurrently — don't block the poll loop.
      // If we await handleMethod here, there's no active fetch during
      // command execution, and Chrome kills the service worker.
      for (const cmd of commands) {
        const { id, method: rawMethod, params, tabId: msgTabId } = cmd
        const method = rawMethod?.replace?.('tap.', '') || rawMethod
        const resolvedParams = { ...(params || {}) }
        if (msgTabId && !resolvedParams.tabId) resolvedParams.tabId = msgTabId

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
