# Extension Testing Guide

## Load Unpacked Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` directory
4. Verify: "Tap" extension appears, version matches `manifest.json`, status enabled

## Run Constraint Tests

All seven tests run via plain `node` (no test framework dep) — they parse
`background.js` / `popup.{html,js}` source as text and assert structural
invariants. CI runs the same set; see `.github/workflows/ci.yml`.

```bash
node extension/test/architecture.test.mjs       # background.js boundary invariants
node extension/test/protocol.test.mjs           # JSON-RPC contract
node extension/test/multi-tab.test.mjs          # session-as-actor / per-tab routing
node extension/test/kernel-behavior.test.mjs    # CDP click chain, key codes, eval scope, screenshot defaults
node extension/test/wire_codes.test.mjs         # extension WIRE_CODE matches core/wire-codes.ts
node extension/test/self-heal.test.mjs          # SAA self-heal — nav binds new tabId to sessionId
node extension/test/popup.test.mjs              # popup state rendering (Layer 3a)
node extension/test/tap-format.test.mjs <dir>   # corpus shape (run against tap-skills clone)
```

## Layer 3b — Popup Visual (real Chromium)

A separate Playwright suite under `extension/e2e/` loads the extension
into real Chromium and verifies the popup renders correctly (CSS,
canonical bridge command literal, install link UTM, version display).
Runs only on PRs touching `extension/**` — see
`.github/workflows/extension-e2e.yml`.

```bash
cd extension/e2e
npm install
npx playwright install chromium
npm test
```

## Verify Extension in Chrome

- [ ] Extension appears in `chrome://extensions/`
- [ ] Version matches `manifest.json`
- [ ] Status: enabled, no errors
- [ ] Service Worker running (click "service worker" link to inspect console)
- [ ] Click toolbar icon → popup shows "Bridge not running" with `tap bridge start` command (when daemon down) OR "Connected to local bridge" (when daemon up)

## Debug

1. Open `chrome://extensions/`
2. Find "Tap" extension
3. Click "service worker" under "Inspect views"
4. Check Console for logs and errors
