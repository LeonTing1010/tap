/**
 * Tap Content Script — Bridge between web pages and extension
 *
 * Allows taprun.dev to demonstrate Tap capabilities directly.
 */

console.log('[tap-content] loaded on', location.hostname)

// Listen for messages from the webpage
window.addEventListener('message', async (e) => {
  // Only accept messages from the same origin or taprun.dev
  if (e.origin !== window.location.origin && !e.origin.includes('taprun.dev')) {
    return
  }

  const { type, payload, id } = e.data || {}
  if (!type || !type.startsWith('TAP_')) return

  console.log('[tap-content] received:', type, payload)

  switch (type) {
    case 'TAP_PING':
      // Respond with extension status
      window.postMessage({
        type: 'TAP_PONG',
        id,
        payload: { connected: true, version: chrome.runtime.getManifest().version }
      }, '*')
      break

    case 'TAP_STAR_GITHUB':
      // Open GitHub and guide user to star
      try {
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

  // Step 2: Wait for page load
  await new Promise(r => setTimeout(r, 3000))

  // Step 3: Try to find and click the Star button
  try {
    // First, let's check if user is logged in by looking for the star button
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
      starButtons: result,
      message: 'GitHub opened. Click the ★ Star button to support us!'
    }
  } catch (err) {
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

// Notify the page that Tap extension is ready
window.postMessage({
  type: 'TAP_READY',
  payload: { version: chrome.runtime.getManifest().version }
}, '*')
