# Tap (Taprun) MCP Server — Installation Guide

This guide is for AI agents (Cline, Claude Code, Claude Desktop, Cursor, Windsurf, Roo Code) installing the Tap MCP server programmatically. Human readers should start with the [README](README.md).

## Overview

Tap turns "do this in my browser" into a deterministic program. Your agent runs `capture` once on a URL × intent — Tap inspects the page, picks the most stable address (open API / session API / in-page fetch / DOM), and emits a bare `.flow.json`. Saved plans replay at **zero LLM tokens** (the AI runs only at capture time), in the user's **own** browser, so credentials never leave the machine.

## Prerequisites

1. **Node.js 18+** (for `npx`-based zero-install — recommended).
2. Network access to `registry.npmjs.org` (first run downloads the platform binary, cached afterwards).
3. Optional: the Tap Chrome extension for login-required sites. Public sites and open APIs work without it via the `playwright` runtime.

## Installation

Add this block to the MCP host's config file (for Cline: `cline_mcp_settings.json`, under `mcpServers`):

```json
{
  "mcpServers": {
    "tap": {
      "command": "npx",
      "args": ["-y", "@taprun/cli", "mcp", "start"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

No API key is required — Tap ships no server-side model and no secrets to configure.

Config file paths by host:

| Host | Config file |
|------|-------------|
| Cline (VS Code) | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `<project>/.cursor/mcp.json` (or `~/.cursor/mcp.json`) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

### Runtime options (optional)

- **extension** (default) — drives the user's real, logged-in Chrome via the Tap Chrome extension (install once from the Chrome Web Store). Full power; reuses existing logins.
- **playwright** — no extension; the engine launches its own dedicated Chrome profile at `~/.tap/profile` (log in once per site). Best for a first-run test with no extension, or headless/CI. Enable with `"env": { "TAP_RUNTIME": "playwright" }` in the block above.

## Verify the install (~1 minute, no login)

After the host restarts, confirm the server started end-to-end:

> List MCP resources — you should see `tap://…` entries — then call `capture` with `{ "url": "https://news.ycombinator.com", "intent": "list the top stories" }` and report the returned `inspection.source_class`.

Expected: a structured `ToolResult` (e.g. `inspection.source_class` = `html-list` / `json-api` / `rss`). Any error in stdout means the host couldn't start the server — usually a stale Node cache; retry after `npm cache clean --force`.

## MCP Tool Surface (v2 — 4 meta verbs + saved taps as Resources)

Tap exposes a **constant** surface of 4 meta verbs. Saved taps are **MCP Resources** (`tap://{site}/{name}`), not per-tap tools — discover them via `resources/list`, read the arg schema via `resources/read`, and execute with `run`.

- **`capture`** — `{ url, intent?, site?, name? }`. Create a tap from URL × intent. With `site+name`, persists to `~/.tap/flows/<site>/<name>.flow.json` and it becomes a `tap://{site}/{name}` resource; without them, returns a preview. Re-capturing the same `site+name` overwrites — the heal path for `tap_drifted`.
- **`verify`** — `{ site, name, args? }`. Read-only substrate health check; runs the observe phase only (safe for write taps). Returns `verdict ∈ { live | drifted | unreachable }` derived from op outcomes.
- **`mark`** — `{ site, name, key, as: "committed" | "aborted" }`. Resolve an `intent_uncertain` record after observing the real side-effect outcome.
- **`run`** — `{ ref, args }` where `ref` is `tap://{site}/{name}` or `{site}/{name}`. Execute a saved tap deterministically — zero AI tokens.

Discovery flow: `resources/list` → match by name/description → `resources/read({uri})` for the args schema → `run({ ref, args })`.

### Closed error envelope

Every failure returns `{ ok:false, kind, message, detail, next? }` with `kind ∈ { tap_not_found, tap_invalid, tap_aborted, tap_drifted, intent_running, intent_uncertain, runtime_unavailable, credential_missing, arg_invalid }`. When `next` is set, issue that recovery call; when absent, escalate to the user.

## Pricing

**All features are free during v0.x.** There is no tier gating, no license token, and no telemetry in the engine.

## Chrome Extension for login-required sites

For sites that need an authenticated session (banking, internal dashboards, social platforms), install the [Tap Chrome Extension](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) and declare `requires.runtime: "extension"` on the plan. Auth is whatever is already in the user's browser — Tap never asks for or transmits credentials.

## Troubleshooting

- **"Command not found: npx"** — install Node.js 18+ from https://nodejs.org.
- **`tap_drifted`** — call `capture { url: <plan.source_url>, intent: <plan.source_intent>, site, name }` to overwrite (heal) the plan.
- **`runtime_unavailable`** — the plan needs `requires.runtime: "extension"` but the Chrome extension isn't running; install it and reload the host, or use `TAP_RUNTIME=playwright`.
- **`credential_missing`** — the plan's `op:fetch` references a `${VAR}` not set. Run `tap secret set <KEY>` (value via stdin); secrets live at `~/.tap/config/secrets`.
- **Host can't start the server** — verify `npx -y @taprun/cli --version` works directly in the user's terminal (usually a network or Node-cache issue).

## References

- Homepage / install: https://taprun.dev/add
- README: https://github.com/LeonTing1010/tap
- npm: https://www.npmjs.com/package/@taprun/cli
- Security: see `SECURITY.md`
