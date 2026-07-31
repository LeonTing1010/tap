---
title: Glama MCP Profile Copy
description: Internal copy pack for the Glama MCP server profile.
sitemap: false
robots: noindex
---

# Glama MCP Server Profile — Copy Pack

Paste into https://glama.ai/mcp/servers/LeonTing1010/tap/admin/profile.
Keyword targets (high-volume Glama searches): **browser automation, web scraping, playwright, chrome, agent, deterministic, monitoring, reliability, MCP**.

---

## 1. Title / Name

```
Tap — Browser Automation for AI Agents
```

Alternates (A/B if Glama supports it):
- `Tap — Reliable Browser Automation & Web Scraping MCP`
- `Tap — Browser Automation MCP with Drift Detection`

---

## 2. One-line Description (≤140 chars)

Primary (use this):

```
Browser automation and web scraping MCP for AI agents. Compile once, run forever, detect drift before your data goes stale.
```

Backups:

```
Reliable browser automation MCP. Turns AI page interactions into deterministic programs with built-in health monitoring.
```

```
Web scraping and browser automation for Claude, Cursor, and Cline. Replay every run exactly — no AI tokens at execution time.
```

---

## 3. Long Description / Summary

```
Tap is a browser automation and web scraping MCP server for AI agents.
Point it at any site once; your agent inspects the page, compiles a
deterministic program, and replays it forever — zero AI tokens at runtime,
same result every call.

Works with Claude Code, Cursor, Cline, Windsurf, and any MCP host.
Runs in the user's real Chrome (login sessions available) or headless
Playwright. 70+ pre-built taps via tap-skills — plus forge your own
from any URL in seconds.

What makes Tap different from runtime-AI browsers (Claude for Chrome,
Atlas, browser-use): Tap separates authoring from execution. The agent
pays tokens once to capture; production runs are pure code. Per-tap
CEL `snapshot_equivalent` predicates catch silent drift the moment a
site changes — not three days later when your pipeline is already
pumping garbage into a database.

Three meta verbs + N saved-tap projections:
  • capture           — create a tap from URL × intent
  • verify            — read-only substrate check; 4-arm verdict
                        (equivalent / drifted / first_snapshot / unreachable)
  • mark              — resolve uncertain intent → committed / aborted
  • <site>.<name>     — every saved tap auto-projects as an MCP tool

Local-first architecture: taps live in ~/.tap/flows/, the binary is a
single zero-dependency Deno compile, and nothing leaves your machine
except license validation. Free tier covers all meta verbs and
saved-tap execution; pricing tiers cap saved-plan count (3 / 5 / 20)
via core/auth.ts:gateCaptureSave.

Install:  npx -y @taprun/cli mcp stdio
Homepage: https://taprun.dev
```

---

## 4. Tags / Keywords

Pick the first 10–15 Glama allows; front-load by search volume.

```
browser-automation
web-scraping
playwright
chrome
ai-agent
claude
cursor
cline
mcp-server
deterministic
monitoring
drift-detection
forge
reliability
headless
reddit
github
linkedin
hacker-news
data-extraction
workflow-automation
```

---

## 5. Categories (pick what Glama offers)

Primary: **Browser Automation** / **Web Scraping**
Secondary: **Developer Tools** / **Data Extraction** / **Monitoring**

---

## 6. README (long-form, rendered on profile page)

See block below — paste as-is if Glama has a dedicated README/Overview field separate from the description.

```markdown
## Tap — Browser Automation MCP for AI Agents

**The problem.** Runtime-AI browsers (Claude for Chrome, Atlas, browser-use)
re-reason about every page on every run. Same page + same prompt = different
click sequence. Tokens scale with traffic. Silent drift is invisible until
data goes wrong downstream.

**What Tap does.** Forge once, run forever. The agent inspects the page,
compiles a deterministic program (a "skill"), and every subsequent call
replays that program with zero AI at execution time. `tap verify` checks each
replay for snapshot equivalence, flagging drift the moment a site changes.

### Quick start

```json
{
  "mcpServers": {
    "tap": { "command": "npx", "args": ["-y", "@taprun/cli", "mcp", "start"] }
  }
}
```

Or wire your agent in one step:

```bash
npx -y @taprun/cli embed claude-code   # or: codebuddy | cursor | vscode | claude-desktop
```

### What you get

| Layer  | What it does                                        |
|--------|------------------------------------------------------|
| Forge  | AI inspects site → compiles skill (one-time cost)    |
| Run    | Skill executes instantly, same result every time     |
| Verify | tap verify — snapshot-equivalence check, 4-arm drift verdict |

### Why agents choose Tap

- **Deterministic output.** Same input → same output. No temperature drift.
- **Zero tokens at runtime.** Pay for forge once. Production is free.
- **Real Chrome or headless.** Logged-in sessions work out of the box.
- **Drift detection.** Cross-validates JSON-LD / API / DOM so "wrong node,
  right shape" failures don't pass silently.
- **70+ pre-built taps via tap-skills.** Or forge your own from any URL.
- **Local-first.** Taps live on your machine. No cloud sync, no data leaks.

### Compatible MCP hosts

Claude Code · Cursor · Cline · Windsurf · Continue · any stdio MCP client.

### Links

- Homepage: https://taprun.dev
- Blog / deep dives: https://taprun.dev/blog
- 70+ community taps: https://github.com/LeonTing1010/tap-skills
- Chrome extension: https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce
```

---

## 7. Per-tool descriptions (if Glama shows them individually)

These are the current canonical descriptions in `core/src/mcp.ts` —
mirror them on Glama so the profile shows the same surface the agent
sees. Keep them ≤160 chars each for Glama display truncation.

| Tool             | Description (Glama-tuned) |
|------------------|---------------------------|
| `capture`        | Create a tap from URL × intent. With site+name, persists to `~/.tap/flows/`. Re-call to heal drifted. |
| `verify`         | Read-only substrate check. 4-arm verdict: equivalent / drifted / first_snapshot / unreachable. |
| `mark`           | Resolve an `intent_uncertain` record → committed or aborted. Use after observing the side effect. |
| `<site>.<name>`  | Every saved tap auto-projects as an MCP tool (e.g. `github.trending`). Args follow the plan's schema. |

---

## 8. Screenshots / demo (Glama displays these prominently)

Upload, in this order:

1. `docs/social-preview.png` — brand card
2. A terminal screenshot showing `tap verify` flagging a drifted tap (generate via any broken demo tap)
3. A Claude Code conversation using the `github.trending` saved-tap projection (real screenshot from `~/Documents/tap/extension/showcase/`)

Missing screenshots are the #1 ranking penalty on Glama — add at least 2.

---

## 9. Pre-submit checklist

- [ ] Title contains "browser automation" AND "MCP" or "AI agent"
- [ ] One-liner is ≤140 chars and leads with the category noun, not the brand
- [ ] README lists compatible hosts by name (Claude Code, Cursor, Cline, Windsurf)
- [ ] At least 2 screenshots uploaded
- [ ] Tags include `browser-automation`, `web-scraping`, `playwright`, `mcp-server`
- [ ] No "open-source", "OSS", "FOSS", or "self-healing" anywhere (per CLAUDE.md rules)
- [ ] Links resolve: taprun.dev, /blog, tap-skills repo, Chrome Web Store listing
- [ ] Install command copies cleanly: `npx -y @taprun/cli mcp stdio`
```