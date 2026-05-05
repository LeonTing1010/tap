/**
 * Tap Content Script — Bridge between web pages and extension
 *
 * Allows taprun.dev to demonstrate Tap capabilities directly.
 */

console.log('[tap-content] loaded on', location.hostname)

// Track if we're connected to background
let backgroundReady = false

// Test connection to background script
async function pingBackground() {
  try {
    const response = await chrome.runtime.sendMessage({ method: 'capabilities' })
    if (response && response.runtime === 'extension') {
      backgroundReady = true
      console.log('[tap-content] background connected, version:', response.version)
      return true
    }
  } catch (e) {
    console.log('[tap-content] background not ready:', e?.message)
    backgroundReady = false
  }
  return false
}

// Wait for background to be ready, then notify page
async function init() {
  // Try to ping background a few times
  for (let i = 0; i < 5; i++) {
    if (await pingBackground()) break
    await new Promise(r => setTimeout(r, 500))
  }

  // Notify the page that Tap extension is ready
  // Use DOMContentLoaded to ensure page scripts are ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyPage)
  } else {
    notifyPage()
  }
}

function notifyPage() {
  try {
    window.postMessage({
      type: 'TAP_READY',
      payload: {
        version: chrome.runtime.getManifest().version,
        backgroundReady
      }
    }, '*')
    console.log('[tap-content] notified page, backgroundReady:', backgroundReady)
  } catch (e) {
    console.error('[tap-content] failed to notify page:', e)
  }
}

// Start initialization
init()

// Listen for messages from the webpage
window.addEventListener('message', async (e) => {
  // Only accept messages from the same origin
  if (e.origin !== window.location.origin) {
    return
  }

  const { type, payload, id } = e.data || {}
  if (!type || !type.startsWith('TAP_')) return

  console.log('[tap-content] received:', type, payload)

  switch (type) {
    case 'TAP_PING':
      // Respond with extension status
      const isReady = await pingBackground()
      window.postMessage({
        type: 'TAP_PONG',
        id,
        payload: {
          connected: isReady,
          version: chrome.runtime.getManifest().version
        }
      }, '*')
      break

    case 'TAP_STAR_GITHUB':
      // Open GitHub and guide user to star
      try {
        if (!backgroundReady) {
          throw new Error('Tap extension background not ready. Please wait a moment and try again.')
        }
        const result = await starGithubRepo(payload?.repo || 'LeonTing1010/tap')
        window.postMessage({
          type: 'TAP_STAR_RESULT',
          id,
          payload: result
        }, '*')
      } catch (err) {
        window.postMessage({
          type: 'TAP_STAR_RESULT',
          id,
          payload: { success: false, error: err.message }
        }, '*')
      }
      break

    case 'TAP_NAVIGATE':
      // Navigate to a URL in background tab
      try {
        if (!backgroundReady) {
          throw new Error('Tap extension not ready')
        }
        const tab = await chrome.runtime.sendMessage({
          method: 'tab.new',
          params: { url: payload.url, active: false }
        })
        window.postMessage({
          type: 'TAP_NAVIGATE_RESULT',
          id,
          payload: { success: true, tabId: tab.tabId }
        }, '*')
      } catch (err) {
        window.postMessage({
          type: 'TAP_NAVIGATE_RESULT',
          id,
          payload: { success: false, error: err.message }
        }, '*')
      }
      break

    case 'TAP_CLICK':
      // Click an element in a specific tab
      try {
        if (!backgroundReady) {
          throw new Error('Tap extension not ready')
        }
        const result = await chrome.runtime.sendMessage({
          method: 'click',
          params: { tabId: payload.tabId, target: payload.selector }
        })
        window.postMessage({
          type: 'TAP_CLICK_RESULT',
          id,
          payload: { success: true, result }
        }, '*')
      } catch (err) {
        window.postMessage({
          type: 'TAP_CLICK_RESULT',
          id,
          payload: { success: false, error: err.message }
        }, '*')
      }
      break
  }
})

/**
 * Star a GitHub repo by opening it and guiding the user
 */
async function starGithubRepo(repo) {
  const url = `https://github.com/${repo}`

  // Step 1: Open GitHub in background tab
  const tab = await chrome.runtime.sendMessage({
    method: 'tab.new',
    params: { url, active: false }
  })

  if (!tab || !tab.tabId) {
    throw new Error('Failed to create tab')
  }

  console.log('[tap-content] created tab:', tab.tabId)

  // Step 2: Wait for page load
  await new Promise(r => setTimeout(r, 3000))

  // Step 3: Try to find the Star button
  try {
    const result = await chrome.runtime.sendMessage({
      method: 'find',
      params: {
        tabId: tab.tabId,
        query: 'Star',
        role: 'button'
      }
    })

    console.log('[tap-content] found star buttons:', result)

    // Return the tab info so the page can guide the user
    return {
      success: true,
      tabId: tab.tabId,
      url,
      starButtons: result || [],
      message: 'GitHub opened. Click the ★ Star button to support us!'
    }
  } catch (err) {
    console.log('[tap-content] find failed:', err)
    // Even if we can't find the button, the tab is open
    return {
      success: true,
      tabId: tab.tabId,
      url,
      starButtons: [],
      message: 'GitHub opened. Look for the ★ Star button in the top right!'
    }
  }
}
