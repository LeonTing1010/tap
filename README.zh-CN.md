<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Taprun">
</p>

<h1 align="center">Taprun</h1>

<h4 align="center">
  你的爬虫现在就是坏的。你只是还不知道。
</h4>

<p align="center">
  <a href="https://taprun.dev/?utm_source=readme-cn&utm_medium=docs&utm_campaign=homepage"><b>主页</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/blog/?utm_source=readme-cn&utm_medium=docs&utm_campaign=blog"><b>博客</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>140+ Skills</b></a> &nbsp;|&nbsp;
  <a href="README.md"><b>English</b></a>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce"><img src="https://img.shields.io/chrome-web-store/v/llcidejeoobdegbkolbjhfoeckphldce?style=flat-square&label=Chrome%20Web%20Store" alt="Chrome Web Store"></a>
</p>

---

**Taprun 是本地优先（local-first）的浏览器自动化 — 跑在你自己的浏览器里，不是别人的云里。** 把 AI 对网站的理解编译成确定性程序，然后持续监控它。你的 cookie 和登录会话永不离开你的机器 — 这是架构决定，不是承诺。健康合约捕获静默故障，指纹对比精确定位变更。`tap doctor` 在数据变质前就发现问题 — 不是三天以后。

```
锻造：  AI 分析网站 → 编译成 .tap.js 程序          （一次性成本）
执行：  程序即时运行，每次结果完全一致              ($0，零 AI）
监控：  tap doctor 检查健康合约 + 指纹对比          （捕获故障）
修复：  AI 读取诊断报告并修补程序                   （仅在需要时）
```

**MCP 是创作层，`tap.run` 是执行层。** AI 只在锻造时参与（一次性成本）。执行是纯代码 — 零 token，确定性输出。140+ skills，覆盖 68+ 网站。一个二进制，零依赖。

## 快速开始

### 1. 安装

**零安装** —— 任何装了 Node 的机器都能直接跑：

```bash
npx -y @taprun/cli --version
```

第一次会自动下载对应平台的二进制（~30MB）并缓存，之后每次秒启动。

**永久安装** —— macOS / Linux 一行命令：

```bash
curl -fsSL https://taprun.dev/install.sh | sh
```

| 平台 | 下载 |
|------|------|
| macOS (Apple Silicon) | [tap-macos-arm64](https://github.com/LeonTing1010/tap/releases/latest) |
| macOS (Intel) | [tap-macos-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Linux | [tap-linux-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Windows | [tap-windows-x64.exe](https://github.com/LeonTing1010/tap/releases/latest) |

### 2. 连接 AI Agent

适用于 Claude Code、Cursor、Windsurf 或任何 MCP 兼容的 Agent — 不需要浏览器扩展：

```json
{ "mcpServers": { "tap": { "command": "npx", "args": ["-y", "@taprun/cli", "mcp", "start"] } } }
```

或一键配置所有已安装的 Agent：

```bash
tap mcp connect
```

### 可选：Chrome 扩展（需要登录的站点）

大部分 tap 不需要登录即可运行。如需访问小红书、知乎等需要登录的站点，从 [Chrome Web Store](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) 安装扩展。

### 4. 开始使用

```bash
tap github/trending              # GitHub 热门仓库
tap hackernews/hot               # Hacker News 首页
tap weibo/hot                    # 微博热搜
tap xiaohongshu/search --keyword "AI"  # 小红书搜索
```

或直接让 AI Agent 操作：

```
你：   今天 GitHub 有什么热门？
Agent：今天最热门的仓库是... React compiler 已达 734 stars...

你：   给我锻造一个豆瓣 Top250 的 tap
Agent：好了。随时运行 `tap douban/top250`，每次 $0。
```

### 已有 Playwright / Puppeteer / Stagehand 脚本？

不要重写。用四个开源 adapter 之一直接转换 — 把已有脚本扔进去，拿一份 Tap 兼容的 `.tap.json` 出来：

```bash
# 已有 Playwright 脚本（npm 47M 周下载，你最可能用的 SDK）
npm install @taprun/from-playwright @taprun/spec
node -e "import('@taprun/from-playwright').then(m => console.log(m.playwrightToTap(require('fs').readFileSync('tests/login.spec.ts','utf8'), {site:'example', name:'login'})))"

# 或一行命令初始化新的 starter
npx create-tap-script github/trending https://github.com/trending
```

| Adapter | 输入格式 | 覆盖范围 |
|---|---|---|
| [`@taprun/from-playwright`](https://www.npmjs.com/package/@taprun/from-playwright) | `.ts/.js` Playwright 测试 | 8 个 page.* API（goto/click/fill/type/press/waitForSelector/waitForTimeout/screenshot） |
| [`@taprun/from-puppeteer`](https://www.npmjs.com/package/@taprun/from-puppeteer) | `.ts/.js` Puppeteer 脚本 | 7 个 page.* API + page.keyboard.press |
| [`@taprun/from-stagehand`](https://www.npmjs.com/package/@taprun/from-stagehand) | `.ts/.js` Stagehand 脚本 | 混合：确定性的 page.* 转 plan op；自然语言 `act/extract/observe` 标 `allowUnverifiable` 让 doctor 透明分流 |
| [`create-tap-script`](https://www.npmjs.com/package/create-tap-script) | （无 — 脚手架） | `<site>/<name> <url>` 一键生成 `.tap.json` 信封 |

格式本身有完整文档：[`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec)（TypeScript 类型 + W3C Annotation 验证器 + JSON Schema 2020-12 + 10-fixture conformance 套件）。规范：[taprun.dev/spec/plan-v1](https://taprun.dev/spec/plan-v1/)。源码：[`packages/`](packages/)。

## 你能用 Taprun 做什么？

**读取** — 从任何网站提取数据

```bash
tap reddit/hot                   # Reddit 首页
tap bilibili/trending            # B站热门
tap arxiv/search --keyword "LLM" # arXiv 论文
```

**写入** — 操作任何网站

```bash
tap xiaohongshu/publish --title "我的笔记" --images photo.jpg
tap zhihu/publish --title "我的文章" --content "..."
```

**监控** — 追踪变化

```bash
tap watch github/trending --every 5m
```

**组合** — 像 Unix 管道一样串联

```bash
tap github/trending | tap filter --field stars --gt 500 | tap table
```

**锻造** — 用 AI 创建新的自动化

```bash
tap forge "获取 Hacker News 热门文章"         # 自带 Claude / GPT key
tap forge https://news.ycombinator.com        # 检测到 API — 无需 AI 直接编译
```

自带模型 — 支持 Claude、OpenAI、DeepSeek，或任何 OpenAI 兼容端点，包括 **本地 Ollama / LM Studio**，实现完全离线锻造：

```bash
tap config set ai.baseUrl http://localhost:11434/v1
tap config set ai.key ollama
tap config set ai.model llama3.1
tap forge "抓取 arxiv 最新论文"                # 0 字节离开你的机器
```

## 工作原理

```
                     ┌─ Chrome      （你的真实浏览器会话）
你 → AI → Taprun ──────┤─ Playwright  （无头模式，服务端，CI/CD）
     编译            └─ macOS       （原生桌面应用）
```

1. **你描述**你想要什么（自然语言或 URL）
2. **AI 编译**成 `.tap.js` 程序 — 纯 JavaScript，可版本控制
3. **Taprun 运行**程序 — 三个运行时任选，永久运行，$0

每次成功编译都让下一次更快。140+ 社区 skills 意味着你的 Agent 已经认识 68+ 个网站。

## 社区 Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 140+ skills，开源。

| 分类 | 示例 |
|------|------|
| **热门/趋势** | GitHub, Hacker News, Reddit, Product Hunt, Bilibili, Zhihu, Weibo, Xiaohongshu |
| **搜索** | arXiv, Reddit, X, Zhihu, Weibo, Xiaohongshu, Bilibili, Medium |
| **阅读** | Zhihu 问答, Bilibili 视频, Xiaohongshu 笔记, 微信读书 |
| **写入** | X 发推, Xiaohongshu 笔记, Zhihu 文章, Dev.to, LinkedIn |
| **监控** | 价格追踪, 股票数据, 竞品分析 |

```bash
tap doctor    # 健康检查 — 在数据变质前捕获静默故障
tap update    # 安装 / 更新所有 skills
tap list      # 查看所有可用 skills
```

## 对比

|  | Taprun | AI 浏览器 Agent | 传统爬虫 |
|--|-----|-----------------|----------|
| **每次运行 AI 成本** | $0（编译一次） | 每次消耗 token | 免费 |
| **准确性** | 确定性 | 每次不同 | 确定性 |
| **静默故障检测** | 健康合约 + 指纹对比 | 无 | 无 |
| **故障诊断** | `tap doctor` — 精确定位变更 | 无 | 手动排查 |
| **检测风险** | 低（真实浏览器会话） | 高 | 高 |
| **运行时** | 3（Chrome + Playwright + macOS） | 1 | 1 |
| **代码可检查** | .tap.js — 可 git diff、调试、版本控制 | 黑盒 / 临时的 | 脆弱脚本 |
| **MCP 原生** | 是（仅创作层 — 执行零 token） | 否 | 否 |

## 架构层面的本地优先（Local-first）

Taprun 跑在 **你的** 浏览器，不是别人的云。Chrome 扩展复用你已有的登录会话；cookie、auth token、凭证从不离开你的机器。这是结构性选择，不是营销承诺：

| 关注点 | 云优先浏览器 SDK | Taprun（local-first） |
|---|---|---|
| 登录 cookie 在哪？ | 在云端供应商服务器 | 只在你本地浏览器 |
| AI 看到什么？ | 完整会话 + 你的数据 | 仅 forge 时的页面 DOM |
| 合规（noindex / robots.txt / TOS） | 供应商替你签 ToS | 你的账号，你的条款 |
| 内网 / Intranet 站点 | 需要 VPN 隧道 | 直接打开页面 |
| 供应商下线风险 | 你的爬虫立即停止 | 本地代码继续运行 |

| 层级 | 保护 |
|------|------|
| **沙箱** | 程序以零权限运行 — 无文件、网络或系统访问 |
| **静态分析** | CI 在到达用户前拦截危险模式 |
| **本地优先** | 你的数据、会话和 API 密钥永不离开你的机器 — 架构决定 |

完整威胁模型详见 [SECURITY.md](SECURITY.md)。

## 贡献

最简单的贡献方式：**锻造一个新 tap。** 只需一个 `.tap.js` 文件。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

- [x] 140+ 社区 skills，覆盖 68+ 网站
- [x] 3 个运行时 — Chrome, Playwright, macOS
- [x] Unix 管道 — `tap A | tap B`
- [x] Watch 模式 — 监控变化
- [x] Doctor — 健康合约、指纹对比、损坏 taps 自动诊断
- [x] 一键配置 — `tap mcp connect` 配置所有 AI Agent
- [ ] Android 运行时
- [ ] iOS 运行时

## 支持

- [GitHub Discussions](https://github.com/LeonTing1010/tap/discussions) — 问答、想法、成果分享
- [support@taprun.dev](mailto:support@taprun.dev) — 授权、私密反馈、咨询
- [Issues](https://github.com/LeonTing1010/tap/issues) — Bug 报告

## 许可证

Chrome 扩展和文档：[MIT](LICENSE)。社区 skills：[MIT](https://github.com/LeonTing1010/tap-skills/blob/main/LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
