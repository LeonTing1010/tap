# Tap (Taprun) MCP Server Installation Guide

This guide is for AI agents (Cline, Claude Desktop, Cursor, Windsurf, Roo Code) installing the Tap MCP server programmatically. Human readers should start with the [README](README.md).

## Overview

Tap turns "browse this site" into a deterministic program. Your agent inspects a page once via `forge.inspect`, compiles a `.tap.json` plan, and replays it forever with `tap.run` — zero AI tokens at runtime, same result every call. Health contracts and structural drift detection catch silent breakage before data goes stale. 140+ pre-built scrapers across 68+ sites (Reddit, GitHub, Hacker News, LinkedIn, Twitter, YouTube, Producthunt, Bilibili, Xiaohongshu, …); forge new ones from any URL.

## Prerequisites

1. **Node.js 16+** (for `npx`-based zero-install — recommended)
2. Network access to `registry.npmjs.org` (first run downloads ~30MB platform binary, cached afterwards)
3. Optional: a real Chrome window for login-required sites (Xiaohongshu, Zhihu, LinkedIn). Public sites work headless out of the box.

## Installation and Configuration

### Step 1 — Add Tap to your MCP host

Add this block to the appropriate config file for the host:

| Host | Config file path |
|------|------------------|
| Cline (VS Code) | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `<project>/.cursor/mcp.json` (or `~/.cursor/mcp.json` for global) |
| Roo Code | `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

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

### Step 2 — (Skip if step 1 worked) Auto-configure all hosts at once

Instead of editing config files manually, run this one command — it detects every installed MCP host and writes the right block to each:

```bash
npx -y @taprun/cli mcp connect
```

### Step 3 — Verify

After restarting the MCP host, ask the agent:

> Run `tap.list` and tell me how many sites are available.

Expected: a site-grouped summary listing 68+ sites. Any error in stdout means the host can't start the server — most commonly a stale Node cache; retry with `npm cache clean --force`.

## Default MCP Tools (Layer 1 — 8 essential)

These load automatically. Use `tap.expand_tools(level: 2)` or `level: 3` to surface more.

### `tap.list`
Discover available pre-built scrapers. Default returns a site-grouped summary. Pass `{query: "..."}` for full-text search across site/name/description, or `{site: "..."}` for the full schema of one site.

### `tap.run`
Execute a pre-built scraper. Returns `{columns, rows, count, timing, cache_hit}`. Read-intent runs are memoized for 5 minutes per process. Args: `{site, name, args?, fresh?}`.

### `tap.doctor`
Health check. Runs the scraper's examples against its declared health contract. Returns `{ok, annotations[], issues[], suggestions[]}`. Each annotation carries `body.tap:verdict ∈ {healthy, broken, stale, layer-mismatch}`.

### `tap.fix`
Diagnose and (Pro tier) repair a broken scraper. Same shape as `tap.doctor` plus `{diagnostics, patches}`.

### `tap.runtime`
Switch browser runtime. `runtime: "chrome"` uses the user's real logged-in Chrome; `runtime: "headless"` uses Playwright (default — fast, no login).

### `tap.env`
Diagnostics: binary version, daemon status, license tier, OS, Playwright availability.

### `forge.inspect`
Analyze a page for new-scraper authoring: detects framework, SSR state, APIs, generates extraction strategies. Pass `{url}` and optionally `{detail: "structure,annotations,a11y"}`.

### `forge.draft` / `forge.save`
Two-step authoring. `forge.draft({plan, url})` verifies a draft plan against a live page; `forge.save({site, name, plan, verify_examples})` writes it to `~/.tap/taps/`.

### `tap.expand_tools`
Surfaces additional tools at higher levels:
- Level 2 (creative): `forge.pipe`, `inspect_download`, `tap.explain`, etc.
- Level 3 (manual): raw browser ops — `tap.click`, `tap.type`, `tap.eval`, `tap.find`, `tap.nav`, `tap.wait`, `tap.cookies`, `tap.pressKey`.

## Optional: Chrome Extension for Login-Required Sites

Most scrapers work headless. For sites that require an authenticated session (Xiaohongshu, Zhihu, LinkedIn, banking, internal dashboards), install the [Chrome Extension](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) and run `tap.runtime({runtime: "chrome"})`. Auth is whatever's already in the user's browser — Tap never asks for or transmits credentials.

## License Tiers

- **Free**: `tap.list`, `tap.run`, `tap.doctor` against 140+ pre-built scrapers + extensible via local `~/.tap/taps/*.tap.json`.
- **Hacker** ($9/mo): Full forge pipeline (`forge.inspect`/`draft`/`save`) for authoring new scrapers via MCP. BYOK AI key.
- **Pro** ($29/mo): `tap.fix` repair + `tap.refresh` rebaseline + scheduled health checks. 100% local — nothing leaves the user's machine except license validation.

`tap config set license <key>` after purchase from https://taprun.dev/?utm_source=llms-install&utm_medium=docs&utm_campaign=cline-purchase. Licenses validate offline after first check.

## Troubleshooting

- **"Command not found: npx"** — install Node.js 16+ from https://nodejs.org.
- **Empty rows on a public site** — call `tap.doctor({site, name})` for structured diagnosis. Returns `{verdict, suggestions}`.
- **Empty rows on a login-required site** — call `tap.runtime({runtime: "chrome"})` first, then retry. If Chrome runtime fails, the user needs to install the Chrome Extension and run `tap bridge start` once.
- **MCP host can't start the server** — verify `npx -y @taprun/cli --version` works directly in the user's terminal. Most failures are network or Node-cache issues.

## References

- Homepage: https://taprun.dev/?utm_source=llms-install&utm_medium=docs&utm_campaign=cline-homepage
- README: https://github.com/LeonTing1010/tap
- npm package: https://www.npmjs.com/package/@taprun/cli
- GitHub Issues: https://github.com/LeonTing1010/tap/issues
- Security: see `SECURITY.md`
