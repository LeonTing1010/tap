<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Tap">
</p>

<h1 align="center">Tap</h1>

<h4 align="center">
  Your scraper is broken right now. You just don't know it yet.
</h4>

<p align="center">
  <a href="https://taprun.dev/"><b>Homepage</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/blog/"><b>Blog</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>140+ Skills</b></a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md"><b>中文</b></a>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce"><img src="https://img.shields.io/chrome-web-store/v/llcidejeoobdegbkolbjhfoeckphldce?style=flat-square&label=Chrome%20Web%20Store" alt="Chrome Web Store"></a>
</p>

---

**Tap compiles AI understanding into deterministic programs. Then monitors them.** Health contracts catch silent failures. Fingerprint diffs tell you exactly what changed. `tap doctor` detects breakage before your data goes stale — not three days later.

```
Forge:    AI inspects the site → compiles a .tap.js program       (one-time cost)
Run:      The program executes instantly, same result every time   ($0, zero AI)
Monitor:  tap doctor checks health contracts + fingerprint diffs  (catches breakage)
Heal:     AI reads diagnostics and patches the program            (only when needed)
```

**MCP is the authoring layer. `tap.run` is the execution layer.** AI participates during forge (one-time). Execution is pure code — zero tokens, deterministic output. 140+ skills across 68+ sites. One binary, zero dependencies.

## Get Started

### 1. Install

**Zero-install** via npx (any machine with Node):

```bash
npx -y @taprun/cli --version
```

The first run downloads the matching platform binary (~30MB) and caches it. Subsequent calls are instant.

**Permanent install** via curl (macOS / Linux):

```bash
curl -fsSL https://taprun.dev/install.sh | sh
```

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [tap-macos-arm64](https://github.com/LeonTing1010/tap/releases/latest) |
| macOS (Intel) | [tap-macos-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Linux | [tap-linux-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Windows | [tap-windows-x64.exe](https://github.com/LeonTing1010/tap/releases/latest) |

### 2. Connect to Your AI Agent

Works with Claude Code, Cursor, Windsurf, or any MCP-compatible agent — no extension needed:

```json
{ "mcpServers": { "tap": { "command": "tap", "args": ["mcp"] } } }
```

Or auto-configure all installed agents:

```bash
tap setup
```

### 3. Go

```bash
tap github trending              # GitHub trending repos
tap hackernews hot               # Hacker News front page
tap weibo hot                    # 微博热搜
tap xiaohongshu search --keyword "AI"  # 小红书搜索
```

Or just ask your AI agent:

```
You:   What's trending on GitHub today?
Agent: Here are today's top repos — React compiler hit 734 stars...

You:   Forge a tap for Douban top 250 movies
Agent: Done. Run `tap douban top250` anytime — $0 per run.
```

### Optional: Chrome Extension (for login-required sites)

Most taps work without login. For sites that need your session (Xiaohongshu, Zhihu, etc.), install the [Chrome Extension](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) from the Chrome Web Store.

## What Can You Do?

**Read** — Extract data from any website

```bash
tap reddit hot                   # Reddit front page
tap bilibili trending            # Bilibili trending
tap arxiv search --keyword "LLM" # arXiv papers
```

**Write** — Operate any website

```bash
tap xiaohongshu publish --title "My Note" --images photo.jpg
tap zhihu publish --title "My Article" --content "..."
```

**Watch** — Monitor changes

```bash
tap watch github trending --every 5m
```

**Compose** — Chain like Unix pipes

```bash
tap github trending | tap filter --field stars --gt 500 | tap table
```

**Forge** — Create new automations with AI

```bash
tap forge "get Hacker News top stories"           # BYOK Claude / GPT
tap forge https://news.ycombinator.com            # API detected — compiled without AI
```

Bring your own model — works with Claude, OpenAI, DeepSeek, or any
OpenAI-compatible endpoint including **local Ollama / LM Studio** for
fully offline forge:

```bash
tap config set ai.baseUrl http://localhost:11434/v1
tap config set ai.key ollama
tap config set ai.model llama3.1
tap forge "scrape arxiv recent papers"            # 0 bytes leave your machine
```

## How It Works

```
                     ┌─ Chrome      (your real browser sessions)
You → AI → Tap ──────┤─ Playwright  (headless, server, CI/CD)
     compile         └─ macOS       (native desktop apps)
```

1. **You describe** what you want (natural language or URL)
2. **AI compiles** it into a `.tap.js` program — plain JavaScript, version-controlled
3. **Tap runs** the program on any of three runtimes — forever, at $0

Every successful compilation makes the next one faster. 140+ community skills mean your agent already knows 68+ websites.

## Community Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 140+ skills, open source.

| Category | Examples |
|----------|---------|
| **Trending** | GitHub, Hacker News, Reddit, Product Hunt, Bilibili, Zhihu, Weibo, Xiaohongshu |
| **Search** | arXiv, Reddit, X, Zhihu, Weibo, Xiaohongshu, Bilibili, Medium |
| **Read** | Zhihu threads, Bilibili videos, Xiaohongshu notes, WeRead books |
| **Write** | X posts, Xiaohongshu notes, Zhihu articles, Dev.to, LinkedIn |
| **Monitor** | Price tracking, stock data, competitor analysis |

```bash
tap doctor    # Health check — catches silent failures before your data goes stale
tap update    # Install / update all skills
tap list      # See everything available
```

## How Tap Compares

|  | Tap | AI Browser Agents | Traditional Scrapers |
|--|-----|-------------------|---------------------|
| **AI cost per run** | $0 (compile once) | Tokens every run | Free |
| **Accuracy** | Deterministic | Varies per run | Deterministic |
| **Silent failure detection** | Health contracts + fingerprint diff | None | None |
| **Breakage diagnostics** | `tap doctor` — exact diff of what changed | None | Manual spot checks |
| **Detection risk** | Low (real browser sessions) | High | High |
| **Runtimes** | 3 (Chrome + Playwright + macOS) | 1 | 1 |
| **Code inspectable** | .tap.js — git diff, debug, version | Black box / ephemeral | Fragile scripts |
| **MCP native** | Yes (authoring layer only — execution is zero tokens) | No | No |

## Security

| Layer | Protection |
|-------|-----------|
| **Sandbox** | Programs run with zero permissions — no file, network, or system access |
| **Static Analysis** | CI blocks dangerous patterns before they reach users |
| **Local-only** | Your data, sessions, and API keys never leave your machine |

See [SECURITY.md](SECURITY.md) for details.

## Contributing

The easiest way to contribute: **forge a new tap.** One `.tap.js` file is all it takes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Roadmap

- [x] 140+ community skills across 68+ sites
- [x] 3 runtimes — Chrome, Playwright, macOS
- [x] Unix pipes — `tap A | tap B`
- [x] Watch mode — monitor changes over time
- [x] Doctor — health contracts, fingerprint diffs, automatic diagnostics for broken taps
- [x] One-command setup — `tap setup` configures all AI agents
- [ ] Android runtime
- [ ] iOS runtime

## License

Chrome Extension & docs: [MIT](LICENSE). Community skills: [MIT](https://github.com/LeonTing1010/tap-skills/blob/main/LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
