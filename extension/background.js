/**
 * Tap Extension — Background Service Worker (Simplified)
 * 
 * Pure API gateway for Chrome Extension runtime.
 * Forwards commands from Deno executor to Chrome APIs.
 * 
 * Usage: Deno creates WebSocket connection → sends commands → Extension executes
 */

console.log('[tap] extension runtime ready (API gateway mode)')

// --- State ---

let activeTabId = null
const debuggerSessions = new Map()

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) clearTimeout(session.detachTimer)
  debuggerSessions.delete(tabId)
  if (tabId === activeTabId) activeTabId = null
})

// --- Helper Functions ---

async function waitForTabLoad(tabId, url = null) {
  await new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId) return
      if (changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
  
  // Check for error pages
  const tab = await chrome.tabs.get(tabId)
  if (tab.url?.startsWith('chrome-error://') || tab.url === '') {
    throw new Error(`Tab failed to load: ${url || tab.url}`)
  }
}

function scheduleDetach(tabId) {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) clearTimeout(session.detachTimer)
  const timer = setTimeout(async () => {
    try {
      await chrome.debugger.detach({ tabId })
      debuggerSessions.delete(tabId)
    } catch { /* ignore */ }
  }, 5000)
  debuggerSessions.set(tabId, { detachTimer: timer })
}

async function withDebugger(tabId, fn) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
    debuggerSessions.set(tabId, { ...debuggerSessions.get(tabId), attached: true })
    return await fn()
  } finally {
    scheduleDetach(tabId)
  }
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

// --- Message Handler ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { method, params, id } = msg
  
  if (!method) {
    sendResponse({ id, error: 'Missing method' })
    return false
  }
  
  handleMethod(method, params, sender.tab?.id)
    .then(result => sendResponse({ id, result }))
    .catch(error => sendResponse({ id, error: error.message }))
  
  return true // async response
})

async function handleMethod(method, params = {}, senderTabId = null) {
  let tabId = params.tabId ? Number(params.tabId) : activeTabId
  
  // Auto-create tab if needed
  if (tabId) {
    try { await chrome.tabs.get(tabId) }
    catch { tabId = null }
  }
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    tabId = tab.id
    console.log(`[tap] created tab ${tabId}`)
  }
  
  switch (method) {
    // === Core Operations ===
    
    case 'eval': {
      const safeExpr = '{\n' + params.expression + '\n}'
      
      // Fast path: debugger attached
      if (debuggerSessions.get(tabId)?.attached) {
        try {
          const r = await chrome.debugger.sendCommand(
            { tabId }, 'Runtime.evaluate',
            { expression: safeExpr, returnByValue: true, awaitPromise: true }
          )
          scheduleDetach(tabId)
          if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description)
          return r?.result?.value
        } catch (e) {
          if (!e.message.includes('detached')) throw e
          debuggerSessions.delete(tabId)
        }
      }
      
      // Normal path: chrome.scripting
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
      throw new Error(wrapped?.error || 'eval failed')
    }
    
    case 'pointer': {
      const { x, y, action = 'click' } = params
      if (action === 'click') {
        await cdpClick(tabId, x, y)
      } else if (action === 'move') {
        await withDebugger(tabId, () =>
          chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        )
      } else if (action === 'down') {
        await withDebugger(tabId, () =>
          chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
          })
        )
      } else if (action === 'up') {
        await withDebugger(tabId, () =>
          chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
          })
        )
      }
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
        const CMD_MAP = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' }
        const cmd = CMD_MAP[key.toLowerCase()]
        if (cmd) commands.push(cmd)
      }
      
      await withDebugger(tabId, async () => {
        if (action === 'type') {
          for (const char of key) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyDown', text: char, key: char
            })
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp', key: char
            })
          }
        } else if (action === 'down') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', modifiers, commands, ...mapped
          })
        } else if (action === 'up') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', modifiers, ...mapped
          })
        } else {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', modifiers, commands, ...mapped
          })
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', modifiers, ...mapped
          })
        }
      })
      return {}
    }
    
    case 'nav': {
      const current = await chrome.tabs.get(tabId)
      if (current.url?.startsWith('chrome://')) {
        const tab = await chrome.tabs.create({ url: params.url })
        tabId = tab.id
      } else {
        await chrome.tabs.update(tabId, { url: params.url })
      }
      await waitForTabLoad(tabId, params.url)
      return { frameId: 'main' }
    }
    
    case 'wait': {
      await new Promise(resolve => setTimeout(resolve, params.ms))
      return {}
    }
    
    case 'screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(tabId, {
        format: params.format || 'jpeg',
        quality: params.quality ?? 50
      })
      return { dataUrl }
    }
    
    case 'cookies': {
      const tab = await chrome.tabs.get(tabId)
      const cookies = await chrome.cookies.getAll({ url: tab.url })
      return { cookies }
    }
    
    case 'storage': {
      const type = params.type || 'local'
      const storage = type === 'session' ? chrome.storage.session : chrome.storage.local
      const data = await storage.get(null)
      return { data }
    }
    
    case 'capabilities': {
      return {
        runtime: 'extension',
        version: '0.4.0',
        supports: ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'cookies', 'storage']
      }
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
