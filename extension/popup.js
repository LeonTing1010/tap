// Popup — surfaces local bridge status with per-failure-mode CTAs.
//
// Background SW is the source of truth for connection state; the popup
// asks via chrome.runtime.sendMessage and re-asks every 2s while open
// (so the user sees the state flip live after they run the fix).
//
// Per ADR 2026-05-13-daemon-extension-via-native-messaging.md: the SW
// surfaces (extensionId, disconnectReason) so the popup can render the
// CORRECT CTA per failure mode — manifest missing vs daemon down vs
// Chrome blocklist — instead of always advising `tap bridge start`.

const SECTION_IDS = [
  'connected',
  'dc-not-installed',
  'dc-host-exited',
  'dc-forbidden',
  'dc-unknown',
]

const $version = document.getElementById('version')

function showOnly(id) {
  for (const sid of SECTION_IDS) {
    const el = document.getElementById(sid)
    if (el) el.hidden = sid !== id
  }
}

/** Map Chrome's lastError.message into a CTA bucket. The message strings
 *  are Chrome-stable user-facing strings — see chromium source
 *  extensions/browser/api/messaging/native_message_host.cc. Order
 *  matters: "forbidden" check before "not found" because the forbidden
 *  message includes the word "host" too. */
function classifyReason(reason) {
  if (!reason) return 'unknown'
  const r = String(reason)
  if (/forbidden/i.test(r)) return 'forbidden'
  if (/not found/i.test(r)) return 'not-installed'
  if (/has exited|error when communicating/i.test(r)) return 'host-exited'
  return 'unknown'
}

function render(status) {
  if (status?.version) $version.textContent = `v${status.version}`

  if (status?.connected === true) {
    showOnly('connected')
    return
  }

  const bucket = classifyReason(status?.disconnectReason)

  if (bucket === 'not-installed') {
    // Per ADR `2026-05-13-install-os-managed-daemon.md` Slice 3: the
    // extension ID is pinned in manifest.json's `"key"` field, so
    // `tap bridge setup` takes no flag. The popup no longer needs to
    // bake an ID into the command — the static markup in popup.html
    // ships the canonical form.
    showOnly('dc-not-installed')
    return
  }

  if (bucket === 'host-exited') {
    showOnly('dc-host-exited')
    return
  }

  if (bucket === 'forbidden') {
    showOnly('dc-forbidden')
    return
  }

  // Unknown reason — show raw text for debugging.
  const rawEl = document.getElementById('raw-reason')
  if (rawEl) rawEl.textContent = status?.disconnectReason || '(no error info)'
  showOnly('dc-unknown')
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'tap-status' }, (resp) => {
    if (chrome.runtime.lastError) {
      // SW asleep / not yet ready — render same as "host-exited" because
      // from the user's perspective the bridge is down for an unknown
      // backend reason. Retry button kicks SW awake which re-fires
      // connectBridge() and updates the real state on next refresh tick.
      render({ connected: false, disconnectReason: 'host has exited' })
      return
    }
    render(resp)
  })
}

document.addEventListener('click', (e) => {
  const t = e.target
  if (!(t instanceof HTMLElement)) return

  if (t.classList.contains('copy')) {
    const text = t.dataset.copy ?? ''
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      t.classList.add('copied')
      const prev = t.textContent
      t.textContent = '✓'
      setTimeout(() => {
        t.classList.remove('copied')
        t.textContent = prev
      }, 1200)
    })
    return
  }

  if (t.classList.contains('retry')) {
    t.disabled = true
    chrome.runtime.sendMessage({ type: 'tap-retry' }, () => {
      setTimeout(() => {
        refresh()
        t.disabled = false
      }, 600)
    })
  }
})

refresh()
const tick = setInterval(refresh, 2000)
window.addEventListener('unload', () => clearInterval(tick))
