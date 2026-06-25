<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Taprun">
</p>

<h1 align="center">Taprun</h1>

<h4 align="center">
  跑在你自己浏览器里的浏览器自动化，而不是别人的云里。
</h4>

<p align="center">
  <a href="https://taprun.dev/?utm_source=readme-cn&utm_medium=docs&utm_campaign=homepage"><b>主页</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/blog/?utm_source=readme-cn&utm_medium=docs&utm_campaign=blog"><b>博客</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/taps/?utm_source=readme-cn&utm_medium=docs&utm_campaign=skills-catalog"><b>70+ Skills</b></a> &nbsp;|&nbsp;
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

**本地优先（local-first）的浏览器自动化。编译一次，永久零 LLM token 重放。**

把 Taprun 指向任何网站。你的 AI agent 把页面分析一次，产出一个确定性的 `.plan.json` 程序。之后永久重放 — 每次调用结果完全一致，$0 token。cookie 和登录会话留在你自己真实的 Chrome 里 — 这是架构决定，不是政策承诺。`tap verify` 在你的数据变质前就发现页面变化。

适用于 Claude Code、Cursor、Cline、Windsurf 以及任何 MCP host。70+ 预建 tap，或从任意 URL 锻造你自己的。

```
捕获：  AI 分析网站 → 编译成 .plan.json 程序        （一次性成本）
执行：  程序即时运行，每次结果完全一致              ($0，零 AI）
验证：  tap verify 检查快照等价断言                 （捕获漂移）
修复：  对同一 site/name 重新执行 capture；         （仅在需要时）
        人工 review 后下一次 verify 重建基线
```

## Taprun 对比

|  | Taprun | AI 浏览器 Agent | 传统爬虫 |
|--|-----|-----------------|----------|
| **每次运行 AI 成本** | $0（编译一次） | 每次消耗 token | 免费 |
| **准确性** | 确定性 | 每次不同 | 确定性 |
| **静默故障检测** | 每个 tap 的 CEL `snapshot_equivalent` 断言 + 四态裁定 | 无 | 无 |
| **故障诊断** | `tap verify` — 精确 diff 出变了什么 | 无 | 手动抽查 |
| **检测风险** | 低（真实浏览器会话） | 高 | 高 |
| **运行时** | 2（Chrome 扩展 + Playwright） | 1 | 1 |
| **代码可检查** | .plan.json — 纯 JSON，13-op 闭集词汇，可 git diff | 黑盒 / 临时的 | 脆弱脚本 |
| **MCP 原生** | 是（仅创作层 — 执行零 token） | 否 | 否 |

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

**或通过 Homebrew**（macOS / Linux）：

```bash
brew install LeonTing1010/tap/taprun
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
{ "mcpServers": { "tap": { "command": "npx", "args": ["-y", "@taprun/cli", "mcp", "stdio"] } } }
```

或直接运行服务：

```bash
tap mcp stdio    # 默认；管道接入你的 MCP host
tap mcp http     # 在 127.0.0.1:7891 上跑 streamable-HTTP（bearer 鉴权）
```

### 3. 开始使用

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

你：   给我捕获一个豆瓣 Top250 的 tap
Agent：好了。随时运行 `tap douban/top250`，每次 $0。
```

### 可选：Chrome 扩展（需要登录的站点）

大部分 tap 不需要登录即可运行。如需访问小红书、知乎等需要会话的站点，从 [Chrome Web Store](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce) 安装扩展。

### 可选：嵌入你自己的 agent 代码（TypeScript / Python）

跳过 MCP — 在你自己的循环里直接调用 `tap` 二进制：

```bash
tap hackernews/top --args '{}'    # JSON 输出到 stdout，成功 exit 0
tap verify hackernews/top         # 四态裁定（equivalent / drifted / first_snapshot / unreachable）
tap capture <url> hackernews/top --intent "front-page top stories"
```

CLI 以 JSON 形式输出 `ToolResult<T>` 信封 —— 和 MCP 接口返回的形状一致 —— 任何有子进程库的语言都能驱动它。完整 verb 列表见 `tap --help`。

### 已有 Playwright / Puppeteer / Stagehand 脚本？

不要重写。用其中一个开源 adapter 直接转换 — 把已有脚本扔进去，拿一份 Tap 兼容的 `.plan.json` 出来：

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
| [`@taprun/from-stagehand`](https://www.npmjs.com/package/@taprun/from-stagehand) | `.ts/.js` Stagehand 脚本 | 混合：确定性的 page.* 转 plan op；自然语言 `act/extract/observe` 被标记，让 verify 给出诚实裁定 |
| [`create-tap-script`](https://www.npmjs.com/package/create-tap-script) | （无 — 脚手架） | 从 `<site>/<name> <url>` 生成一个起步 `.plan.json` 信封 |

格式本身有完整文档：[`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) —— 公共协议接口包：v2 Plan 的 TypeScript 类型（13-op 闭集联合 + 区分式的读/写 Plan 联合）+ JSON Schema 2020-12，其 `$id` 可在 `taprun.dev/spec/plan-v1/schema.json` 解析，并与 TS 类型双向漂移校验。第三方工具（IDE `$schema` 补全、Python/Ruby/Go 中的 ajv 等价校验器、治理层、替代运行时、带 plan 感知权限作用域的 MCP host）都基于此包构建，无需依赖专有的 Tap 引擎。Plan-v1 规范：[taprun.dev/spec/plan-v1](https://taprun.dev/spec/plan-v1/)。五个包的源码：[`packages/`](packages/)（workspace 总览见 [`packages/README.md`](packages/README.md)）。

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
tap verify github/trending        # 发现漂移；用 cron / launchd 定时跑
```

**组合** — 像 Unix 管道一样串联

```bash
tap github/trending | tap filter --field stars --gt 500 | tap table
```

**锻造** — 用 AI 创建新的自动化

```bash
tap capture https://news.ycombinator.com hackernews/hot --intent "top stories"   # 检测到 API — 无需 AI 直接编译
tap capture https://example.com mysite/home --intent "..."                       # 长尾页面走 BYOK Claude / GPT
```

自带模型 — 支持 Claude、OpenAI、DeepSeek，或任何 OpenAI 兼容端点，包括 **本地 Ollama / LM Studio**，实现完全离线锻造：

```bash
tap config set ai.baseUrl http://localhost:11434/v1
tap config set ai.key ollama
tap config set ai.model llama3.1
tap capture https://arxiv.org/list/cs.AI/recent arxiv/recent --intent "recent papers"  # 0 字节离开你的机器
```

## 工作原理

```
                        ┌─ Chrome 扩展  （你的真实浏览器会话）
你 → AI → Taprun ──────┤
     capture            └─ Playwright   （无头模式，服务端，CI/CD）
```

1. **你描述**你想要什么（URL × 自然语言意图）
2. **AI 编译**成 `.plan.json` 程序 — 纯 JSON，13-op 闭集词汇，可版本控制
3. **Taprun 运行**程序 — 两个运行时任选，永久运行，$0

每次成功编译都让下一次更快。70+ 社区 tap 意味着你的 Agent 已经认识常见的网站模式。

## 社区 Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 70+ tap，开源。

| 分类 | 示例 |
|------|------|
| **热门/趋势** | GitHub, Hacker News, Reddit, Product Hunt, Bilibili, Zhihu, Weibo, Xiaohongshu |
| **搜索** | arXiv, Reddit, X, Zhihu, Weibo, Xiaohongshu, Bilibili, Medium |
| **阅读** | Zhihu 问答, Bilibili 视频, Xiaohongshu 笔记, 微信读书 |
| **写入** | X 发推, Xiaohongshu 笔记, Zhihu 文章, Dev.to, LinkedIn |
| **监控** | 价格追踪, 股票数据, 竞品分析 |

```bash
tap verify <site>/<name>   # 快照等价 — 在数据变质前捕获静默故障
tap list                   # 查看所有可用 tap
tap show <site>/<name>     # 以 JSON 形式打印已保存 tap 的 plan
```

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

最简单的贡献方式：**锻造一个新 tap。** 只需一个 `.plan.json` 文件。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

- [x] 70+ 社区 tap，覆盖 70+ 网站
- [x] 2 个运行时 — Chrome 扩展 + Playwright（无头 / CI）
- [x] Unix 管道 — `tap A | tap B`
- [x] Watch 模式 — 随时间监控变化
- [x] `tap verify` — 快照等价、四态裁定，损坏 tap 的精确漂移诊断
- [x] 单命令 MCP 服务 — `tap mcp stdio`（或 `tap mcp http`）接入任意 MCP host
- [ ] Android 运行时
- [ ] iOS 运行时
- [ ] 并发控制 — 多 agent 并行操作共享账号的确定性协调

## 支持

- [GitHub Discussions](https://github.com/LeonTing1010/tap/discussions) — 问答、想法、成果分享
- [support@taprun.dev](mailto:support@taprun.dev) — 授权、私密反馈、咨询
- [Issues](https://github.com/LeonTing1010/tap/issues) — Bug 报告

## 许可证

Chrome 扩展和文档：[MIT](LICENSE)。社区 skills：[MIT](https://github.com/LeonTing1010/tap-skills/blob/main/LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
