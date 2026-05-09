// Popup — surfaces local bridge status + first-time setup hint when down.
//
// Background SW is the source of truth for connection state; the popup
// asks via chrome.runtime.sendMessage and re-asks every 2s while open
// (so the user sees the state flip live after they run `tap bridge start`).

const $connected = document.getElementById('connected')
const $disconnected = document.getElementById('disconnected')
const $version = document.getElementById('version')
const $retry = document.getElementById('retry')

function render(status) {
  if (status?.version) $version.textContent = `v${status.version}`
  const ok = status?.connected === true
  $connected.hidden = !ok
  $disconnected.hidden = ok
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'tap-status' }, (resp) => {
    if (chrome.runtime.lastError) {
      // Background SW asleep / not yet ready — show disconnected state.
      render({ connected: false })
      return
    }
    render(resp)
  })
}

document.addEventListener('click', (e) => {
  const t = e.target
  if (t instanceof HTMLElement && t.classList.contains('copy')) {
    const text = t.dataset.copy ?? ''
    navigator.clipboard.writeText(text).then(() => {
      t.classList.add('copied')
      const prev = t.textContent
      t.textContent = '✓'
      setTimeout(() => {
        t.classList.remove('copied')
        t.textContent = prev
      }, 1200)
    })
  }
})

$retry.addEventListener('click', () => {
  $retry.disabled = true
  chrome.runtime.sendMessage({ type: 'tap-retry' }, () => {
    setTimeout(() => {
      refresh()
      $retry.disabled = false
    }, 600)
  })
})

refresh()
const tick = setInterval(refresh, 2000)
window.addEventListener('unload', () => clearInterval(tick))
