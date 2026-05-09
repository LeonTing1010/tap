# v0.15.9 release notes — DRAFT

**Status**: Drafted 2026-05-09. Cannot ship until v0.15.6 clears Chrome Web Store review (currently blocking v0.15.7 / v0.15.8 / v0.15.9 uploads with `ITEM_NOT_UPDATABLE`).

## When v0.15.6 is published in CWS

1. Confirm v0.15.6 status at https://chrome.google.com/webstore/devconsole — must show **Published** (not "Pending review" / "Ready to publish").
2. Paste the `<div class="version-block">` block below into `public/docs/changelog.html` directly above the v0.15.8 block (line 136).
3. From `core/`: `./scripts/release.sh patch` — this auto-bumps `npm/cli/package.json` + `public/extension/manifest.json` + `public/docs/_data/cli.yml` to 0.15.9, commits, tags `v0.15.9`, pushes.
4. CI takes over: core/ release.yml ships npm/PyPI/Homebrew/MCP-Registry; public/ publish-extension.yml uploads to CWS (will succeed once v0.15.6 is no longer blocking).
5. Delete this draft file in the same commit that adds the changelog block, OR after release lands.

## Changelog block to paste

```html
<div class="version-block">
<h2><a href="https://github.com/LeonTing1010/tap/releases/tag/v0.15.9">v0.15.9</a> <span class="date">May DD, 2026</span></h2>
<div class="version-highlight">
<strong>Setup is visible.</strong> Click the extension icon and you see a popup that says whether the bridge is running, the exact command to start it (<code>tap bridge start</code>, copy-paste ready), and a retry button. The previous version had a silent service-worker reconnect loop and an icon-click that opened taprun.dev/install in a new tab whether you needed it or not. The corresponding MCP error envelope now routes "bridge not running" to <code>start_daemon</code> instead of "reload the service worker" — agents get the right recovery hint on the first try.
</div>
<h3>Features</h3>
<ul>
<li><strong>Extension popup onboarding.</strong> New <code>popup.html</code> + <code>popup.js</code> + <code>popup.css</code> (~225 LoC, dark-mode aware, no dependencies). Two states: "Connected to local bridge" with privacy note, or "Bridge not running" with copy-button-equipped <code>tap bridge start</code> + retry + first-time install link. Status polled every 2s while popup open via new <code>tap-status</code> / <code>tap-retry</code> SW message channel; <code>chrome.action.onClicked</code> listener removed (defunct once <code>default_popup</code> is set in manifest).</li>
<li><strong><code>start_daemon</code> recovery action wired end-to-end.</strong> The <code>UserActionKind</code> existed in the closed enum but had no emit path until now. <code>core/_ext_relay.ts</code> tags <code>peer_unreachable.detail</code> with a named sentinel (<code>DETAIL_PREFIX_BRIDGE_DOWN</code> exported from <code>core/op-result.ts</code>) when <code>ensureDaemon</code> can't fork or when the loopback fetch hits ECONNREFUSED; <code>classifyOpFailure</code> reads the sentinel and returns <code>{ kind: "start_daemon" }</code> with the literal <code>tap bridge start</code> command in the message. Producer + consumer are pinned by separate static guards so removing the prefix from <code>_ext_relay.ts</code> fails CI.</li>
</ul>
<h3>Fixes</h3>
<ul>
<li><strong>Vocabulary alignment.</strong> Badge title says "Tap — bridge not running" (was "daemon not running"); <code>USER_ACTION_DEFAULT_META.start_daemon</code> swaps "daemon" → "bridge" + the actual CLI verb <code>tap bridge start</code> (was a stale <code>tap daemon</code> reference). CLAUDE.md's banned-word rule now structurally enforced — keyword regex test rewritten to require "bridge" in the message.</li>
<li><strong>Drop redundant <code>[tap-ws] connect failed</code> log.</strong> Browser-emitted <code>ERR_CONNECTION_REFUSED</code> in <code>chrome://extensions</code> Errors panel cannot be silenced from JS, but our extra console.log was double-logging the same event. Removed; comment in <code>background.js</code> documents what's possible vs. what isn't.</li>
</ul>
<h3>Engine cleanup (no user-visible change)</h3>
<ul>
<li><strong>~680 LoC of zero-consumer infrastructure dissolved.</strong> <code>core/telemetry.ts</code> (363 LoC), <code>core/k-delta.ts</code> (203 LoC), and the <code>appendRun</code> + <code>runs/</code> directory writer were shipped at v2 launch (2026-05-03) but never wired to a runtime path; the <code>"heal"</code> Transition kind and <code>"heal_applied"</code> StreamEvent kind were closed-enum members with no emitter. Same dissolution shape as <code>core/auth.ts</code> 2026-05-04. ADR <code>2026-05-09-telemetry-and-k-delta-dissolved.md</code> records the dissolution invariant: re-introduction requires a named first consumer + atomic ship + arch-test update. Net result: CLAUDE.md's "no telemetry" claim is now structurally true rather than an opt-in default.</li>
</ul>
</div>
```

## Cross-repo file inventory included in v0.15.9

**core/** (already pushed to `origin/master`):
- `90adbac` api: route bridge-down failures to `start_daemon`
- `f297389` persistence: delete `appendRun` + `runs/` ghost
- `3dd93b9` docs: restore Root layout governance section (recovery)
- `639f143` core: dissolve telemetry + k-delta + heal
- `50c7a6b` test/arch: static guards against re-introduction

**public/** (already pushed to `origin/main`):
- `e807941` extension: drop redundant connect-failed log; align badge vocab to "bridge"
- `32994a3` extension: popup onboarding for bridge-not-running state

The changelog block above covers the user-facing surface of all 7 commits. Internal-only commits (`f297389`, `3dd93b9`, `639f143`, `50c7a6b`) are summarized as one bullet under "Engine cleanup".

## What this draft does NOT include

- Date on the `<h2>` line is `May DD, 2026` — fill in the actual ship day before pasting.
- Link to v0.15.9 GitHub release will 404 until the tag is pushed; that's normal — paste anyway, the link resolves once `release.sh` pushes the tag.
- No version bump in `cli.yml` / `manifest.json` / `npm/cli/package.json` — `release.sh patch` does that atomically.
