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
- [ ] Click toolbar icon → popup shows the matching disconnect bucket (Setup required / Bridge not running / Chrome blocked the host / Bridge down) when the host can't bridge, OR "Connected to local bridge" when it can

## Debug

1. Open `chrome://extensions/`
2. Find "Tap" extension
3. Click "service worker" under "Inspect views"
4. Check Console for logs and errors

## Pre-Release Cross-OS Smoke (manual, ~10 min per release)

Run before tagging a new `v0.x.y`. CI already covers parts of this — see
the **Already in CI** column. Manual focus is the two cells CI cannot
reach: Windows install (no CI runner / no installer yet) and the full
native-messaging wire (CI tests popup HTML in headless xvfb but never
spawns the real `tap` binary + opens a real Chrome with the extension
loaded).

| # | Step | Already in CI? | What to assert |
|---|---|---|---|
| 0 | **Refresh the CLI binary** — `brew update && brew upgrade taprun` (macOS) or re-run the curl installer (Linux); if developing on local source, rebuild via `./scripts/build-all.sh` and confirm the dev shim's NM manifest still points at the new binary | ❌ | The next step's `tap --version` must come from the *just-shipped* binary, not a previous release |
| 1 | **CLI version check** — `tap --version` | macOS install path via `brew-smoke.yml`; Linux install path via `release-smoke.yml` (ubuntu-latest) | `tap --version` equals the latest `v*` tag on the **tap-core** repo (i.e. `core/npm/cli/package.json` `version` field) — NOT the extension manifest, which is on an independent track. CLI and extension co-release but can be bumped separately. If mismatch, step 0 didn't refresh; fix that first |
| 2 | **Register native-messaging manifest** — `tap bridge setup` | ❌ | exit 0; manifest landed at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.taprun.daemon.json` (macOS) or `~/.config/google-chrome/NativeMessagingHosts/dev.taprun.daemon.json` (Linux). Canonical host name is `dev.taprun.daemon` (`core/native-messaging/extension_id.ts` → `NATIVE_HOST_NAME`); `allowed_origins` array contains the extension ID |
| 3 | **Install extension from CWS, open popup** | popup HTML rendering via `extension-e2e.yml` (no real CLI connection) | popup row shows "Connected to local bridge" with green dot. If it shows a disconnect bucket, the wire is broken — STOP and diagnose before tagging |
| 4 | **Reconnect MCP host if you just edited engine source.** Then run a smoke tap end-to-end — e.g. `mcp__tap__run smoke/open_tab` from an MCP-connected agent, or directly: `tap run smoke/open_tab` | ❌ | A new Chrome tab opens at the smoke URL. Popup stays connected throughout. If you get `runtime_unavailable: engine stale — source edited`, restart the MCP host (the engine self-protects against running stale code after a source mtime moves past `process_start_ms`) |
| 5 | **Diagnostic verifies wire** — `tap bridge status` | ❌ | exit 0, stdout exactly `bridge: connected (host.sock at <HOME>/.tap/host.sock)`. The flag `--json` is **NOT** supported (the impl ignores `parsed`); don't expect machine-readable output here |

If any of 2/3/4/5 regresses after a CI-green merge, that's a CI gap — add
the assertion to the corresponding workflow before next release rather
than relying on this checklist to catch it again.

### Windows status

There is no Windows install path as of 2026-05-28. `install.sh` is bash,
no PowerShell installer, no Scoop / Chocolatey package. If you have a
Windows machine, the test you can run is "does the prebuilt
`tap-windows-x64.exe` from the GitHub release artifact start when
double-clicked, and does `tap --version` work from a PowerShell prompt
after putting it on `PATH`?" — that's a Stage-zero install check, not a
full smoke. Ship the installer first; expanding this checklist for
Windows is downstream of that.

### When to upgrade to CI

Currently the manual checklist is right because release cadence is
~weekly-or-less and engagement is low (per the 2026-05-21 distribution-
motion gate). When release cadence climbs to multi-per-week, automate
steps 2/4/5 via a Playwright integration test that loads the extension
into persistent-context Chromium and spawns a real `tap` binary on the
same machine. That's a 1-2 day build and replaces the manual cells in
the table above.
