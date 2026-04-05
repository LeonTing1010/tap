<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Tap">
</p>

<h1 align="center">Tap</h1>

<h4 align="center">
  8 operations. Any interface. Zero AI at runtime.
</h4>

<p align="center">
  <a href="https://taprun.dev/"><b>Homepage</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>Community Skills</b></a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md"><b>中文</b></a>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
</p>

---

**Tap is an AI Coding Agent Protocol.** AI observes an interface once, forges a deterministic `.tap.js` program, then any agent replays it forever — no AI, no tokens, no hallucinations. $0 per run.

```
First run:  AI inspects the interface → forges .tap.js    (one-time cost)
Every run:  .tap.js replays deterministically              ($0.00, forever)
```

The protocol: **8 core operations** → **17 built-in operations** → **any runtime** (Chrome, Playwright, macOS). A new runtime implements 8 methods and gets everything else for free.

## Get Started

Everything you need: **one binary + one extension.**

### Step 1: Install

Download from [Releases](https://github.com/LeonTing1010/tap/releases/latest) or run:

```bash
curl -fsSL https://taprun.dev/install.sh | sh
```

| Platform | Binary |
|----------|--------|
| macOS (Apple Silicon) | `tap-aarch64-apple-darwin.tar.gz` |
| macOS (Intel) | `tap-x86_64-apple-darwin.tar.gz` |

The `tap` binary includes everything: CLI, MCP server, executor, and all runtimes. No dependencies.

### Step 2: Load Chrome Extension

Download `tap-extension.zip` from [Releases](https://github.com/LeonTing1010/tap/releases/latest), unzip, then:

Open `chrome://extensions/` → Enable Developer mode → Load unpacked → select the unzipped folder

### Step 3: Connect to Your AI Agent

Add to Claude Code, Cursor, Windsurf, or any MCP-compatible agent:

```json
{
  "mcpServers": {
    "tap": { "command": "tap", "args": ["mcp"] }
  }
}
```

### Step 4: Go

```bash
tap github trending             # GitHub trending repos
tap hackernews hot               # HackerNews front page
tap zhihu hot                    # Zhihu trending topics
tap github trending | tap filter --field stars --gt 1000  # Unix pipes
```

Or ask your AI agent:

```
You:   What's trending on GitHub today?
Agent: [runs tap github/trending] Here are today's top repos...

You:   Post this to Twitter
Agent: [runs tap x/post] Done. Posted to @YourHandle.
```

## The Protocol

8 irreducible operations define every human-computer interaction. Everything else composes from these.

**8 core operations** — the atoms:

```
eval · pointer · keyboard · nav · wait · screenshot · run · capabilities
```

**17 built-in operations** — composed from core, free for every runtime:

```
click · type · fill · hover · scroll · pressKey · select · upload · dialog
fetch · find · cookies · download · waitFor · waitForNetwork · ssrState · storage
```

Implement 8 methods for a new runtime → get 17 built-in operations + every existing tap for free.

### Architecture

```
                    ┌─ Chrome Extension  (your real browser)
AI Agent ←→ MCP ←→ Tap Executor ─┤─ Playwright        (headless, CI/CD)
                                  └─ macOS             (native apps)
```

- **Chrome Extension** — Runtime #1. Real browser, real sessions. Undetectable (Extensions API first, CDP only for input).
- **Playwright** — Runtime #2. Headless mode, no extension needed. Server-side automation.
- **macOS** — Runtime #3. Native desktop app automation via Accessibility API (JXA + CGEvent + AX).

### Self-Distillation

Every successful forge makes the next one faster. The community flywheel:

1. AI observes an interface → forges a `.tap.js` program (one-time AI cost)
2. Program runs deterministically forever ($0 per run)
3. Community shares the skill → every agent benefits
4. More agents → more interfaces covered → more skills for everyone

200+ community-forged skills already cover 65+ sites. Your agent starts with all of them.

### .tap.js

A tap is plain JavaScript. No dependencies, no build step:

```js
export default {
  site: "github", name: "trending",
  description: "GitHub trending repositories",
  health: { min_rows: 5, non_empty: ["repo"] },

  async run(tap) {
    await tap.nav("https://github.com/trending")
    return tap.eval(() =>
      [...document.querySelectorAll("article.Box-row")].map(el => ({
        repo: el.querySelector("h2 a")?.textContent?.trim(),
        stars: el.querySelector(".octicon-star")?.parentElement?.textContent?.trim()
      }))
    )
  }
}
```

## What Can You Do With Tap?

**Read** — Extract data from any website

```bash
tap reddit hot                   # Reddit front page
tap bilibili trending            # Bilibili trending videos
tap arxiv search --keyword "LLM" # Search arXiv papers
```

**Write** — Operate any website

```bash
tap x post --content "Hello world"
tap xiaohongshu publish --title "My Note" --images photo.jpg
tap zhihu publish --title "My Article" --content "..."
```

**Watch** — Monitor changes over time

```bash
tap watch github trending --every 5m
tap watch hackernews hot --every 10m
```

**Compose** — Chain taps like Unix commands

```bash
tap github trending | tap filter --field stars --gt 500 | tap pick --fields repo,stars
```

**Forge** — Create new automations with AI

```
You:   forge.inspect https://example.com
AI:    Found REST API, recommends fetch strategy
You:   forge.save example data
AI:    Saved. Now `tap example data` runs forever at $0.
```

## Community Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 200+ skills, open source, community-forged.

| Category | Sites |
|----------|-------|
| **Trending** | GitHub, HackerNews, Reddit, ProductHunt, X, YouTube, Bilibili, Zhihu, Weibo, Xiaohongshu, V2EX, Juejin, and more |
| **Search** | Reddit, arXiv, X, Zhihu, Weibo, Xiaohongshu, Bilibili, Douyin, WeChat, Medium |
| **Deep Read** | Zhihu, Weibo, Bilibili, Xiaohongshu, Douyin, WeChat, WeRead |
| **Write** | X, Weibo, Xiaohongshu, Zhihu, Juejin, Dev.to, Medium, Telegraph, LinkedIn, Reddit, and more |
| **Media** | Jimeng AI (text-to-image), macOS screen recording |

```bash
tap update    # Install / update all community skills
tap list      # See everything available
tap doctor    # Health check your taps
```

## How Tap Compares

|  | Tap | Browser-Use / Stagehand | Playwright / Puppeteer |
|--|-----|------------------------|----------------------|
| **AI at runtime** | No (forge once) | Yes (every step) | No (manual scripts) |
| **Detection risk** | Undetectable (Extensions API) | Detectable (CDP) | Detectable (headless) |
| **Cost per run** | $0.00 | Tokens every time | Free |
| **Accuracy** | Deterministic | AI-dependent | Deterministic |
| **Runtimes** | 3 (Chrome + Playwright + macOS) | 1 | 1 |
| **Reusable** | .tap.js (shareable) | Ephemeral | Test scripts |
| **MCP native** | Yes | No | No |
| **Self-healing** | Yes (doctor + auto re-forge) | No | No |

## Security

Community taps are untrusted code. Three layers of defense:

| Layer | What it blocks |
|-------|---------------|
| **Deno Worker Sandbox** | File access, network, subprocesses, env vars |
| **Static Analysis (CI)** | eval, Function, base64, WebSocket, import() |
| **Data Isolation** | Secrets, sessions, API keys never leave your machine |

See [SECURITY.md](SECURITY.md) for details.

## Distribution

Tap ships as **one binary + one extension**. No package manager, no dependencies, no build step.

| Component | What | Source |
|-----------|------|--------|
| `tap` binary | CLI, MCP server, executor, all runtimes | [Releases](https://github.com/LeonTing1010/tap/releases/latest) |
| Chrome Extension | Runtime #1 — your real browser | [Releases](https://github.com/LeonTing1010/tap/releases/latest) / [source](extension/) |
| Community Skills | 200+ skills across 65+ sites, open source | [tap-skills](https://github.com/LeonTing1010/tap-skills) |

### This Repository

```
extension/
  background.js     Chrome Extension service worker (API gateway)
  manifest.json     Extension manifest (MV3)
  icons/            Extension icons
  test/             Architecture & protocol constraint tests
docs/               Homepage (taprun.dev)
```

## Development

```bash
# Extension constraint tests
node extension/test/architecture.test.mjs     # Architecture constraints
node extension/test/protocol.test.mjs         # Protocol constraints
node extension/test/multi-tab.test.mjs        # Multi-tab constraints
node extension/test/tap-format.test.mjs       # Tap format constraints
```

To test the extension locally: load `extension/` as an unpacked extension in Chrome Developer mode. See [extension/TESTING.md](extension/TESTING.md) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The easiest way to contribute: **forge a new tap.** Just one `.tap.js` file.

## Roadmap

- [x] 200+ community skills across 65+ sites
- [x] 3 runtimes — Chrome Extension, Playwright, macOS
- [x] Unix pipes — `tap A | tap B`
- [x] Watch mode — `tap watch site name --every 5m`
- [x] Sandbox + security CI
- [x] Doctor — self-healing health checks
- [x] `tap doctor --auto` — re-forge broken taps automatically
- [ ] Android runtime (AccessibilityService)
- [ ] iOS runtime (XCUITest)

## License

This repository (Chrome Extension, docs, tests) is [MIT](LICENSE).

The `tap` CLI binary is free to use but proprietary — see [LICENSE](LICENSE) for details.

Community skills: [tap-skills](https://github.com/LeonTing1010/tap-skills) (MIT).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
