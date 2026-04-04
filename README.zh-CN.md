<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Tap">
</p>

<h1 align="center">Tap</h1>

<h4 align="center">
  AI Agent 的界面协议
</h4>

<p align="center">
  <a href="https://taprun.dev/"><b>主页</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>社区 Skills</b></a> &nbsp;|&nbsp;
  <a href="README.md"><b>English</b></a>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
</p>

---

Tap 是一套协议，让 AI Agent 能操控任何用户界面 — 浏览器、原生应用、移动设备 — 通过一组最小且确定性的操作。

AI 做一次难的部分（理解页面），然后生成一个 `.tap.js` 程序永久运行 — 不需要 AI、不消耗 token、不会幻觉。

```
第一次运行：AI 分析页面 → 生成 .tap.js    （一次性成本）
之后每次：  .tap.js 确定性重放             （¥0）
```

## 快速开始

你只需要：**一个二进制 + 一个扩展。**

### 第 1 步：安装

从 [Releases](https://github.com/LeonTing1010/tap/releases/latest) 下载，或运行：

```bash
curl -fsSL https://taprun.dev/install.sh | sh
```

| 平台 | 二进制 |
|------|--------|
| macOS (Apple Silicon) | `tap-aarch64-apple-darwin.tar.gz` |
| macOS (Intel) | `tap-x86_64-apple-darwin.tar.gz` |

`tap` 二进制包含一切：CLI、MCP 服务器、执行器、所有运行时。零依赖。

### 第 2 步：加载 Chrome 扩展

从 [Releases](https://github.com/LeonTing1010/tap/releases/latest) 下载 `tap-extension.zip`，解压后：

打开 `chrome://extensions/` → 开启开发者模式 → 加载已解压的扩展程序 → 选择解压后的目录

### 第 3 步：连接 AI Agent

添加到 Claude Code、Cursor、Windsurf 或任何 MCP 兼容的 Agent：

```json
{
  "mcpServers": {
    "tap": { "command": "tap", "args": ["mcp"] }
  }
}
```

### 第 4 步：开始使用

```bash
tap github trending             # GitHub 热门仓库
tap hackernews hot               # HackerNews 首页
tap zhihu hot                    # 知乎热榜
tap github trending | tap tap/filter --field stars --gt 1000  # Unix 管道
```

或让 AI Agent 操作：

```
你：     今天 GitHub 有什么热门？
Agent：  [运行 tap github/trending] 今天最热门的仓库是...

你：     发到 Twitter
Agent：  [运行 tap x/post] 已发布到 @YourHandle。
```

## 协议

Tap 定义了一套最小且完备的界面操作契约。

**8 个核心操作** — 人机交互的不可约原子：

```
eval · pointer · keyboard · nav · wait · screenshot · run · capabilities
```

**17 个内置操作** — 由核心组合而成，每个运行时免费获得：

```
click · type · fill · hover · scroll · pressKey · select · upload · dialog
fetch · find · cookies · download · waitFor · waitForNetwork · ssrState · storage
```

新运行时实现 8 个方法 → 立刻获得 17 个内置操作和所有已有的 `.tap.js` 脚本。

### 架构

```
AI Agent ←→ MCP ←→ Tap Executor ─┬─ Chrome Extension  （真实浏览器）
                                  ├─ Playwright        （无头模式，CI/CD）
                                  └─ macOS             （原生应用）
```

- **Chrome 扩展** — 运行时 #1。真实浏览器、真实登录态。无 headless 检测，无指纹伪造。
- **Playwright** — 运行时 #2。支持无头模式，无需扩展。服务端自动化。
- **macOS** — 运行时 #3。原生桌面应用自动化，Accessibility API。

### .tap.js

Tap 是纯 JavaScript。零依赖，零构建步骤：

```js
// API 优先：直接获取数据
export default {
  site: "bilibili", name: "hot",
  description: "B站热门视频",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2',
      { credentials: 'include' })
    const data = await res.json()
    return data.data.list.map(v => ({
      title: v.title, author: v.owner.name,
      views: String(v.stat.view),
      url: 'https://bilibili.com/video/' + v.bvid
    }))
  }
}
```

```js
// 操作：通过 tap API 操控界面
export default {
  site: "x", name: "post",
  description: "发推文",
  args: { content: { type: "string" } },

  async run(tap, args) {
    await tap.nav('https://x.com/compose/post')
    await tap.type('[data-testid="tweetTextarea_0"]', args.content)
    await tap.click('[data-testid="tweetButton"]')
    await tap.wait(3000)
    return [{ status: 'posted', url: await tap.eval(() => location.href) }]
  }
}
```

## 你能用 Tap 做什么？

**读取** — 从任何网站提取数据

```bash
tap reddit hot                   # Reddit 首页
tap bilibili trending            # B站热门视频
tap arxiv search --keyword "LLM" # 搜索 arXiv 论文
```

**写入** — 操作任何网站

```bash
tap x post --content "Hello world"
tap xiaohongshu publish --title "我的笔记" --images photo.jpg
tap zhihu publish --title "我的文章" --content "..."
```

**监控** — 追踪变化

```bash
tap watch github trending --every 5m
tap watch hackernews hot --every 10m
```

**组合** — 像 Unix 命令一样串联

```bash
tap github trending | tap tap/filter --field stars --gt 500 | tap tap/pick --fields repo,stars
```

**锻造** — 用 AI 创建新的自动化

```
你：     forge.inspect https://example.com
Agent：  发现 REST API，推荐 fetch 策略
你：     forge.save example data
Agent：  已保存。现在 `tap example data` 永久运行。
```

## 社区 Skills

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** — 开源，社区维护。

| 分类 | 站点 |
|------|------|
| **热门/趋势** | GitHub, HackerNews, Reddit, ProductHunt, X, YouTube, B站, 知乎, 微博, 小红书, V2EX, 掘金 等 |
| **搜索** | Reddit, arXiv, X, 知乎, 微博, 小红书, B站, 抖音, 微信, Medium |
| **深度阅读** | 知乎, 微博, B站, 小红书, 抖音, 微信公众号, 微信读书 |
| **写入** | X, 微博, 小红书, 知乎, 掘金, Dev.to, Medium, Telegraph, LinkedIn, Reddit 等 |
| **媒体** | 即梦 AI（文生图）, macOS 录屏 |

```bash
tap update    # 安装 / 更新社区 skills
tap list      # 查看所有可用 skills
tap doctor    # 健康检查
```

## 对比

| 你的需求 | 最佳工具 | 原因 |
|---------|---------|------|
| AI Agent 的确定性界面操作 | **Tap** | 预置 skills，运行时零 LLM 成本，MCP 原生 |
| 通用 LLM 驱动浏览 | Browser-Use, Stagehand | LLM 每步决策 — 灵活但慢且贵 |
| 大规模爬取 | Crawl4AI, Scrapy | 专为吞吐量和规模构建 |
| E2E 测试 | Playwright, Cypress | 测试框架，不是 Agent 协议 |

## 安全

社区 taps 是不受信任的代码。三层防御：

| 层级 | 阻止什么 |
|------|---------|
| **Deno Worker 沙箱** | 文件访问、网络、子进程、环境变量 |
| **静态分析 (CI)** | eval, Function, base64, WebSocket, import() |
| **数据隔离** | 密钥、会话、API Key 永远不离开你的机器 |

详见 [SECURITY.md](SECURITY.md)。

## 分发

Tap 的分发模型：**一个二进制 + 一个扩展。** 无包管理器，无依赖，无构建步骤。

| 组件 | 内容 | 来源 |
|------|------|------|
| `tap` 二进制 | CLI、MCP 服务器、执行器、所有运行时 | [Releases](https://github.com/LeonTing1010/tap/releases/latest) |
| Chrome 扩展 | 运行时 #1 — 你的真实浏览器 | [Releases](https://github.com/LeonTing1010/tap/releases/latest) / [源码](extension/) |
| 社区 Skills | 55+ 站点，开源 | [tap-skills](https://github.com/LeonTing1010/tap-skills) |

### 本仓库

```
extension/
  background.js     Chrome 扩展 Service Worker（API 网关）
  manifest.json     扩展清单（MV3）
  icons/            扩展图标
  test/             架构与协议约束测试
docs/               主页 (taprun.dev)
```

## 开发

```bash
# 扩展约束测试
node extension/test/architecture.test.mjs     # 架构约束
node extension/test/protocol.test.mjs         # 协议约束
node extension/test/multi-tab.test.mjs        # 多标签约束
node extension/test/tap-format.test.mjs       # Tap 格式约束
```

本地测试扩展：在 Chrome 开发者模式下加载 `extension/` 目录。详见 [extension/TESTING.md](extension/TESTING.md)。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。最简单的贡献方式：**锻造一个新 tap。** 只需一个 `.tap.js` 文件。

## 路线图

- [x] 社区 skills 覆盖 55+ 站点
- [x] 3 个运行时 — Chrome 扩展, Playwright, macOS
- [x] Unix 管道 — `tap A | tap B`
- [x] Watch 模式 — `tap watch site name --every 5m`
- [x] 沙箱 + 安全 CI
- [x] Doctor — 自愈健康检查
- [ ] Android 运行时 (AccessibilityService)
- [ ] iOS 运行时 (XCUITest)
- [ ] `tap doctor --auto` — 自动修复损坏的 taps

## 许可证

本仓库（Chrome 扩展、文档、测试）采用 [MIT](LICENSE) 协议。

`tap` CLI 二进制免费使用但闭源 — 详见 [LICENSE](LICENSE)。

社区 skills：[tap-skills](https://github.com/LeonTing1010/tap-skills)（MIT）。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
