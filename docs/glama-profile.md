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
Playwright. 140+ pre-built skills across 68+ sites (Reddit, GitHub,
Hacker News, LinkedIn, Twitter, YouTube, Producthunt, and more) — plus
forge your own from any URL in seconds.

What makes Tap different from runtime-AI browsers (Claude for Chrome,
Atlas, browser-use): Tap separates authoring from execution. The agent
pays tokens once to forge; production runs are pure code. Health
contracts and structural fingerprints catch silent drift the moment a
site changes — not three days later when your pipeline is already
pumping garbage into a database.

Eight core tools with progressive disclosure:
  • tap.list       — discover available skills
  • tap.run        — execute a skill (zero-AI, deterministic)
  • tap.doctor     — health check + drift detection
  • tap.fix        — diagnose and repair a broken skill
  • tap.runtime    — switch Chrome ↔ headless
  • forge.inspect  — analyze a page (framework, API, SSR, auth, selectors)
  • forge.draft    — load a plan in memory and verify live
  • forge.save     — persist the skill to disk and git

Local-first architecture: skills live in ~/.tap/, the binary is a single
zero-dependency Deno compile, and nothing leaves your machine except
license validation. Free tier covers tap.list / tap.run / tap.doctor
with unlimited use.

Install:  npx -y @taprun/cli mcp start
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
replays that program with zero AI at execution time. Health contracts and
structural fingerprints flag drift the moment a site changes.

### Quick start

```json
{
  "mcpServers": {
    "tap": { "command": "npx", "args": ["-y", "@taprun/cli", "mcp", "start"] }
  }
}
```

Or auto-configure all installed agents:

```bash
npx -y @taprun/cli mcp connect
```

### What you get

| Layer  | What it does                                        |
|--------|------------------------------------------------------|
| Forge  | AI inspects site → compiles skill (one-time cost)    |
| Run    | Skill executes instantly, same result every time     |
| Doctor | Health contracts + fingerprint diff detect breakage  |
| Fix    | Diagnostics + patch proposal when a skill breaks     |

### Why agents choose Tap

- **Deterministic output.** Same input → same output. No temperature drift.
- **Zero tokens at runtime.** Pay for forge once. Production is free.
- **Real Chrome or headless.** Logged-in sessions work out of the box.
- **Drift detection.** Cross-validates JSON-LD / API / DOM so "wrong node,
  right shape" failures don't pass silently.
- **140+ pre-built skills** across 68+ sites. Or forge your own from any URL.
- **Local-first.** Skills live on your machine. No cloud sync, no data leaks.

### Compatible MCP hosts

Claude Code · Cursor · Cline · Windsurf · Continue · any stdio MCP client.

### Links

- Homepage: https://taprun.dev
- Blog / deep dives: https://taprun.dev/blog
- 140+ community skills: https://github.com/LeonTing1010/tap-skills
- Chrome extension: https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce
```

---

## 7. Per-tool descriptions (if Glama shows them individually)

These are the current canonical descriptions in `core/src/mcp.ts` —
mirror them on Glama so the profile shows the same surface the agent
sees. Keep them ≤160 chars each for Glama display truncation.

| Tool           | Description (Glama-tuned) |
|----------------|---------------------------|
| `tap.list`     | Discover skills. No args → grouped summary. `{query}` → ranked search. `{site,name}` → full schema. |
| `tap.run`      | Run a compiled skill. Zero AI, deterministic, ~100ms. Pass `{fresh:true}` to bypass the 5-min cache. |
| `tap.doctor`   | Health check. Runs examples, diffs fingerprint, returns verdict: healthy / broken / stale / layer-mismatch. |
| `tap.fix`      | Diagnose a broken skill: current DOM vs expected selectors, auth wall detection, redirect analysis, patch proposal. |
| `tap.runtime`  | Switch between `chrome` (real browser, login sessions) and `headless` (Playwright, fast, no login). |
| `forge.inspect`| Analyze any URL: framework, SSR state, API traffic, auth, a11y tree, anti-scraping mechanisms, extraction strategies. |
| `forge.draft`  | Load a skill plan in memory and optionally verify it live against a URL. Returns score + rows. |
| `forge.save`   | Persist the skill to `~/.tap/taps/` and auto-commit to git. Then `tap.run` executes it forever. |

---

## 8. Screenshots / demo (Glama displays these prominently)

Upload, in this order:

1. `docs/social-preview.png` — brand card
2. A terminal screenshot showing `tap doctor` flagging a drifted skill (generate via any broken demo skill)
3. A Claude Code conversation using `tap.run github/trending` (real screenshot from `~/Documents/tap/extension/showcase/`)

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
- [ ] Install command copies cleanly: `npx -y @taprun/cli mcp start`
```