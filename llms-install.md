# Tap (Taprun) MCP Server Installation Guide

This guide is for AI agents (Cline, Claude Desktop, Cursor, Windsurf, Roo Code) installing the Tap MCP server programmatically. Human readers should start with the [README](README.md).

## Overview

Tap turns "browse this site" into a deterministic program. Your agent runs `capture` once on a URL × intent — Tap inspects the page, picks the strongest structural address (JSON API / RSS / JSON-LD / OpenGraph / HTML list), and emits a bare v2 Plan. Every saved plan is auto-projected as the MCP tool `<site>.<name>` and replays at zero AI tokens. Run `verify` to detect drift before your pipeline notices. ~70 community taps via [tap-skills](https://github.com/LeonTing1010/tap-skills); forge new ones from any URL.

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
      "args": ["-y", "@taprun/cli", "mcp", "stdio"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Step 2 — Verify

After restarting the MCP host, ask the agent:

> Call the `capture` tool with `{ url: "https://news.ycombinator.com" }` (preview only) and tell me what `inspection.source_class` it returned.

Expected: a `ToolResult<CaptureValue>` with `inspection.source_class` (e.g. `html-list`, `json-api`, `rss`). Any error in stdout means the host can't start the server — most commonly a stale Node cache; retry with `npm cache clean --force`.

## MCP Tool Surface (v2 — 3 meta verbs + N saved-tap projections)

The Tap MCP server exposes a flat surface: 3 meta verbs and one auto-projected tool per saved tap.

### Meta verbs

#### `capture`
Create a tap from a URL × intent. Args: `{ url, intent?, site?, name? }`. With `site+name`, persists the resulting Plan to `~/.tap/plans/<site>/<name>.plan.json`; without them, returns a preview only. Re-calling with an existing `site+name` overwrites — this is the heal path for `tap_drifted` failures. Use when the user describes a task and no `<site>.<name>` tool covers it, or when a tap call returned `tap_drifted`.

#### `verify`
Read-only substrate check. Args: `{ site, name, args? }`. Runs the tap's observe phase, captures a Snapshot, compares to the prior baseline. Returns `verdict ∈ {equivalent | drifted | first_snapshot | unreachable}` derived from the per-tap CEL `snapshot_equivalent` predicate. Does NOT execute the act phase — safe for write taps. Use before retrying a failed tap or when the user asks "is my tap still working?".

#### `mark`
Resolve an `intent_uncertain` record. Args: `{ site, name, key, as: "committed" | "aborted" }`. The runtime hit a state where it cannot determine if a side effect committed (process aborted mid-act, heartbeat lost). After observing the actual outcome, mark resolves the intent state machine. Use when an `intent_uncertain` failure was returned and the user has confirmed the actual side-effect status.

### Saved-tap projections

Every saved plan auto-exposes as the MCP tool `<site>.<name>` (e.g. `github.trending`, `hackernews.hot`). Args follow the plan's declared `args` schema. Calling executes the plan deterministically — zero AI tokens.

### Closed error envelope (9 kinds)

Every failure returns a structured envelope with `kind` ∈ `{ tap_not_found, tap_invalid, tap_aborted, tap_drifted, intent_running, intent_uncertain, runtime_unavailable, credential_missing, arg_invalid }`. When `next` is set, it is the single rational recovery action — issue that tool call. When `next` is missing, escalate to the user.

## Optional: Chrome Extension for Login-Required Sites

Most read-only public sites work via the headless `playwright` peer. For sites that require an authenticated session (Xiaohongshu, Zhihu, LinkedIn, banking, internal dashboards), install the [Chrome Extension](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) and declare `requires.runtime: "extension"` on the plan. Auth is whatever's already in the user's browser — Tap never asks for or transmits credentials.

## License Tiers

| Marketing tier | Internal | Plan-fleet cap | What it adds |
|---|---|---|---|
| **Spec & Run** (Free) | `free` | 3 saved plans | All meta verbs + `<site>.<name>` execution + community taps |
| **Capture** ($19/mo) | `hacker` | 5 saved plans | AI-assisted forge for the long-tail of sites; BYOK AI key |
| **Repair** ($49/mo) | `pro` | 20 saved plans | 3-path repair pipeline (cache → minimal-patch → full rewrite) |

Saved-plan caps are enforced in `core/auth.ts:gateCaptureSave`. Re-saving an existing `site+name` (overwrite / heal) does NOT consume budget. License token cached at `~/.tap/license`; unknown product / expired / canceled → safe-failure to `free`.

Purchase at https://taprun.dev/#pricing (Creem). Multi-seat / on-prem / SOC2 / HIPAA buyers contact sales via the footer link.

## Troubleshooting

- **"Command not found: npx"** — install Node.js 16+ from https://nodejs.org.
- **`tap_drifted` returned** — call `capture { url: <plan.source_url>, intent: <plan.source_intent>, site, name }` to overwrite the plan. The next `verify` rebaselines.
- **`runtime_unavailable` returned** — the plan declares `requires.runtime: "extension"` but the Chrome extension isn't running. Install the extension and reload the host.
- **`credential_missing` returned** — the plan's `op:fetch` references a `${VAR}` not in `~/.tap/secrets`. Run `tap secret <KEY>` to set it (value via stdin).
- **MCP host can't start the server** — verify `npx -y @taprun/cli --version` works directly in the user's terminal. Most failures are network or Node-cache issues.

## References

- Homepage: https://taprun.dev/?utm_source=llms-install&utm_medium=docs&utm_campaign=cline-homepage
- README: https://github.com/LeonTing1010/tap
- npm package: https://www.npmjs.com/package/@taprun/cli
- GitHub Issues: https://github.com/LeonTing1010/tap/issues
- Security: see `SECURITY.md`
