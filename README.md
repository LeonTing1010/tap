<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Tap">
</p>

<h1 align="center">Tap</h1>

<h4 align="center">
  Automate any website. AI compiles it. Runs forever at $0.
</h4>

<p align="center">
  <a href="https://taprun.dev/"><b>Homepage</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/blog/"><b>Blog</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>200+ Skills</b></a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md"><b>中文</b></a>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
</p>

---

**Tell AI what you want. Tap compiles it into a program. The program runs forever — no AI, no tokens, no surprises.**

```
First run:  AI inspects the website → compiles a .tap.js program  (one-time cost)
Every run:  The program runs instantly, same result every time     ($0.00, forever)
```

200+ websites already supported. One binary, zero dependencies.

## Get Started

### 1. Install

```bash
curl -fsSL https://taprun.dev/install.sh | sh
```

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | [tap-macos-arm64](https://github.com/LeonTing1010/tap/releases/latest) |
| macOS (Intel) | [tap-macos-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Linux | [tap-linux-x64](https://github.com/LeonTing1010/tap/releases/latest) |

### 2. Load Chrome Extension

Download `tap-extension.zip` from [Releases](https://github.com/LeonTing1010/tap/releases/latest), unzip, then:

`chrome://extensions/` → Developer mode → Load unpacked → select the folder

### 3. Connect to Your AI Agent

Works with Claude Code, Cursor, Windsurf, or any MCP-compatible agent:

```json
{ "mcpServers": { "tap": { "command": "tap", "args": ["mcp"] } } }
```

Or auto-configure all installed agents:

```bash
tap setup
```

### 4. Go

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
tap forge "get Hacker News top stories"
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

Every successful compilation makes the next one faster. 200+ community skills mean your agent already knows 65+ websites.

## Community Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 200+ skills, open source.

| Category | Examples |
|----------|---------|
| **Trending** | GitHub, Hacker News, Reddit, Product Hunt, Bilibili, Zhihu, Weibo, Xiaohongshu |
| **Search** | arXiv, Reddit, X, Zhihu, Weibo, Xiaohongshu, Bilibili, Medium |
| **Read** | Zhihu threads, Bilibili videos, Xiaohongshu notes, WeRead books |
| **Write** | X posts, Xiaohongshu notes, Zhihu articles, Dev.to, LinkedIn |
| **Monitor** | Price tracking, stock data, competitor analysis |

```bash
tap update    # Install / update all skills
tap list      # See everything available
tap doctor    # Health check your taps
```

## How Tap Compares

|  | Tap | AI Browser Agents | Traditional Scrapers |
|--|-----|-------------------|---------------------|
| **AI cost per run** | $0 (compile once) | Tokens every run | Free |
| **Accuracy** | Deterministic | Varies per run | Deterministic |
| **Self-healing** | Yes (auto re-compile) | No | No |
| **Detection risk** | Low (real browser) | High | High |
| **Runtimes** | 3 (browser + headless + desktop) | 1 | 1 |
| **Reusable** | .tap.js (shareable) | Ephemeral | Fragile scripts |
| **MCP native** | Yes | No | No |

## Security

| Layer | Protection |
|-------|-----------|
| **Sandbox** | Programs run with zero permissions — no file, network, or system access |
| **Static Analysis** | CI blocks dangerous patterns before they reach users |
| **Local-only** | Your data, sessions, and API keys never leave your machine |

See [SECURITY.md](SECURITY.md) for details.

## Pricing

| Plan | Price | What you get |
|------|-------|-------------|
| **Free** | $0 | Run 200+ skills, forge with your own AI key, health checks |
| **Hacker** | $9/mo | Auto-healing, change monitoring, plugins, macOS runtime |
| **Pro** | $29/mo | Built-in AI (no key needed), scheduled runs, priority support |

Every plan: unlimited runs at $0. See [taprun.dev](https://taprun.dev/#pricing).

## Contributing

The easiest way to contribute: **forge a new tap.** One `.tap.js` file is all it takes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Roadmap

- [x] 200+ community skills across 65+ sites
- [x] 3 runtimes — Chrome, Playwright, macOS
- [x] Unix pipes — `tap A | tap B`
- [x] Watch mode — monitor changes over time
- [x] Self-healing — auto re-compile broken taps
- [x] One-command setup — `tap setup` configures all AI agents
- [ ] Android runtime
- [ ] iOS runtime

## License

Chrome Extension & docs: [MIT](LICENSE). Community skills: [MIT](https://github.com/LeonTing1010/tap-skills/blob/main/LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
