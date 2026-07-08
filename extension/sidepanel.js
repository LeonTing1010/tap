/**
 * Tap side panel — a persistent, always-visible control console (ADR
 * 2026-07-08-op-capabilities). Unlike the ephemeral popup, the side panel
 * stays docked while runs execute, so it can show live status, the last
 * picked resolver, and act as the human-in-the-loop handoff surface (e.g.
 * "click the one gesture-bound button" moments).
 *
 * Read-only reflection of extension state via chrome.storage; the background
 * SW is the source of truth. Browser-live — no unit harness for the DOM.
 */
'use strict'

const $ = (id) => document.getElementById(id)

function renderBridge(connected) {
  const dot = $('bridgeDot'), st = $('bridgeState')
  if (!dot || !st) return
  dot.classList.toggle('live', !!connected)
  st.textContent = connected ? 'bridge connected — local, zero-token replay' : 'bridge not running — click the toolbar icon → Retry'
}

function renderPicked(resolver, at) {
  const el = $('picked')
  if (!el) return
  if (!resolver) return
  el.className = ''
  el.textContent = JSON.stringify(resolver, null, 2) + (at ? `\n\n// picked ${new Date(at).toLocaleTimeString()}` : '')
  window.__lastResolver = resolver
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function renderNotify(n) {
  // op:notify → plan→human message channel. Injects/updates a banner near the
  // top of the panel (ADR 2026-07-08-op-capabilities).
  let el = document.getElementById('tap-notify')
  if (!n || !n.message) { if (el) el.remove(); return }
  if (!el) {
    el = document.createElement('section')
    el.id = 'tap-notify'
    el.style.borderColor = 'rgba(111,66,193,.5)'
    document.body.insertBefore(el, document.body.firstChild.nextSibling)
  }
  el.innerHTML = `<h2>Message from plan</h2><div>${escapeHtml(n.message)}</div>` +
    (n.at ? `<div class="muted" style="margin-top:4px">${new Date(n.at).toLocaleTimeString()}</div>` : '')
}

async function refresh() {
  try {
    const s = await chrome.storage.local.get([
      'tap:bridgeConnected', 'tap:lastPickedResolver', 'tap:lastPickedAt', 'tap:notify',
    ])
    renderBridge(s['tap:bridgeConnected'])
    renderNotify(s['tap:notify'])
    renderPicked(s['tap:lastPickedResolver'], s['tap:lastPickedAt'])
  } catch (_) { /* storage unavailable */ }
}

chrome.storage?.onChanged?.addListener((changes, area) => { if (area === 'local') refresh() })

$('copyPicked')?.addEventListener('click', async () => {
  if (window.__lastResolver) {
    try { await navigator.clipboard.writeText(JSON.stringify(window.__lastResolver)) } catch (_) {}
  }
})

refresh()
setInterval(refresh, 2000)
