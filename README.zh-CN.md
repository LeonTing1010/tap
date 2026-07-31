<p align="center">
  <img src="extension/icons/icon.svg" width="120" height="120" alt="Taprun">
</p>

<h1 align="center">Taprun</h1>

<h4 align="center">
  agent 在你登录态浏览器里的闭环行动层 —— 专吃 API 够不到、卡在最后 20% 例外/合规的活。录一次，永久零 token 重放。
</h4>

<p align="center">
  <a href="https://taprun.dev/?utm_source=readme-cn&utm_medium=docs&utm_campaign=homepage"><b>主页</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/blog/?utm_source=readme-cn&utm_medium=docs&utm_campaign=blog"><b>博客</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/LeonTing1010/tap-skills"><b>已验证判断</b></a> &nbsp;|&nbsp;
  <a href="https://taprun.dev/?utm_source=readme-cn&utm_medium=docs&utm_campaign=drift-alerts#drift-alerts"><b>📬 漂移预警</b></a> &nbsp;|&nbsp;
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

**agent 的浏览器闭环行动层：登录态门控、例外繁多、合规关键的「最后 20%」—— 干净 API 够不到的那部分活。跑在你自己的 Chrome 里，录一次，永久零 LLM token 重放。**

当 API 被圈起来收费，真正剩下的活都躲在登录、OTP、真人手势这些门后面 —— 那些云 agent 架构上碰不到的例外、审批、合规步骤。Taprun 就是干这个的行动层：你的 agent 驱动你自己已登录的 Chrome，闭环跑完（执行 → 核验效果 → 漂移即重跑），再把一份你拥有的确定性重放交到你手上。

别的浏览器 agent 每跑一次都要现场调一次大模型、反复烧 token。Taprun 让 AI 把页面分析**一次**，产出确定性的 `.flow.json` 程序；之后每次重放都是纯数据派发 —— 每次结果完全一致，**$0 token，agent 不在运行路径**。它跑在你自己真实的 Chrome 里，cookie 和登录会话因此留在你机器上（架构决定）。`tap verify` 在数据变质前发现页面变化。

适用于 Claude Code、CodeBuddy、Cursor、Cline、Windsurf 以及任何 MCP host —— 在聊天窗口里就能装。任意 URL 按需锻造 tap——不需要目录。

```
捕获：  AI 分析网站 → 编译成 .flow.json 程序        （一次性成本）
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
| **代码可检查** | .flow.json — 纯 JSON，18-op 闭集词汇，可 git diff | 黑盒 / 临时的 | 脆弱脚本 |
| **MCP 原生** | 是（仅创作层 — 执行零 token） | 否 | 否 |

## 快速开始

### 1. 接入你的 Agent —— 在聊天窗口里就能装

**Claude Code / CodeBuddy** —— 往聊天框粘两行，别的都不用：

```
/plugin marketplace add LeonTing1010/taprun
/plugin install tap@taprun
```

这会装上 Taprun MCP 服务，**外加**教 agent 何时用它的 skill、以及把被墙的 fetch 路由到 Taprun 的 hook —— 不进终端、不写配置文件。（CodeBuddy 只在启动时接线插件 MCP 服务，所以装完要**完全重启一次**；Claude Code 用 `/reload-plugins` 即可。）

**其他任意 MCP host**（Cursor · VS Code · Claude Desktop）—— 一条命令替你写好配置：

```bash
npx -y @taprun/cli embed cursor   # 或：vscode | claude-desktop | claude-code | codebuddy | qwen
```

二进制自动拷贝到 `~/.tap/bin`，Agent 的 MCP 配置自动写好。随时用 `tap embed --verify` 复查。

> **你的 coding agent 不在这个列表里？** `tap embed` 的 target 是**数据不是代码**：往 `~/.tap/embed-targets.json` 里加一行，新 agent 立即可用——不用等引擎发版。每行指定四种装法**类型**之一（`cc-plugin`=Claude Code 插件宿主 / `cli-mcp-add`=有 `<cli> mcp add` 的 CLI / `ide-deeplink` / `desktop-bundle`），例如 `[{"id":"kode","kind":"cc-plugin","display":"Kode CLI","tier":1,"cli":"kode"}]`。和 Taprun 其余部分同一信条——引擎保持封闭机械，扩展发生在本地数据里。

接着选运行时 —— **只有要复用你「已登录的真实 Chrome」时才需要扩展：**

- **公开页面 / 开放 API / CI —— 不用再装任何东西。** MCP 服务跑在 `npx` 上，到此为止。想要一条完全在聊天里的路径就加 `--no-extension`（Playwright 运行时 + 独立 profile，无浏览器手势、无点击）。
- **需要登录的站点**（银行 / 内部后台 / 小红书 / 知乎）—— 直接在聊天里对 agent 说**「帮我给登录态站点 set up tap」**。**tap-setup** skill 会在聊天里把整条桥装好：从 `npx` 已下载的引擎里落位稳定二进制（**不会二次下载**）、写好 native-messaging manifest，然后打开扩展页面。唯一不是聊天动作的一步，就是那一下 **[Add to Chrome](https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce)** 点击 —— 它正是让 Taprun 能复用你现有登录态的信任闸；点完，进行中的调用自动续跑。
- **Claude Desktop**：下载 [`tap.mcpb`](https://github.com/LeonTing1010/tap/releases/latest) 双击安装。

<details>
<summary><b>其他安装方式</b>（brew · curl · 手写 MCP JSON · 原始二进制）</summary>

```bash
brew install LeonTing1010/tap/taprun            # Homebrew（macOS / Linux）
curl -fsSL https://taprun.dev/install.sh | sh   # 永久安装
npx -y @taprun/cli --version                    # 零安装（任何 Node 环境）
```

想手写 MCP 配置的话：

```json
{ "mcpServers": { "tap": { "command": "npx", "args": ["-y", "@taprun/cli", "mcp", "stdio"] } } }
```

| 平台 | 下载 |
|------|------|
| macOS（Apple Silicon） | [tap-macos-arm64](https://github.com/LeonTing1010/tap/releases/latest) |
| macOS（Intel） | [tap-macos-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Linux | [tap-linux-x64](https://github.com/LeonTing1010/tap/releases/latest) |
| Windows | [tap-windows-x64.exe](https://github.com/LeonTing1010/tap/releases/latest) |

</details>

### 2. 验证它真的能跑（约 2 分钟，无需登录）

跑一下[判断台账](https://github.com/LeonTing1010/tap-skills)的第一条——和它每晚 CI 跑的是同一份验证：

```bash
mkdir -p ~/.tap/flows/github
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap-skills/main/claims/2026-07-11-github-trending-has-no-api/plan.json \
  -o ~/.tap/flows/github/trending-no-api.flow.json
tap github/trending-no-api
```

看到 `"state": "committed"` 和今天的 trending 仓库列表（零 token）= 安装成功**且**判断成立。

### 3. 锻造你自己的 tap

```bash
tap capture https://news.ycombinator.com hn/front --intent "首页热帖标题和分数"
tap hn/front        # 永久重放，$0
```

或者直接让你的 AI Agent 来：

```
你：   今天 GitHub 上什么在热榜？
Agent: 这是今天的热门仓库 —— React compiler 涨了 734 star...

你：   给豆瓣电影 Top 250 建一个 tap
Agent: 搞定。以后随时跑 `tap douban/top250` —— 每次 $0。
```

### 可选：从你自己的代码驱动（TypeScript / Python）

跳过 MCP，直接在你的循环里调 `tap` 二进制：

```bash
tap capture <url> hackernews/top --intent "首页热帖"
tap hackernews/top --args '{}'    # stdout 输出 JSON，成功 exit 0
tap verify hackernews/top         # 3 臂判定（live / drifted / unreachable）
```

CLI 输出 `ToolResult<T>` JSON 信封——与 MCP 接口同构——任何有 subprocess 的语言都能驱动。完整动词表见 `tap --help`。

### 已有 Playwright / Puppeteer / Stagehand 脚本？

不要重写。用其中一个开源 adapter 直接转换 — 把已有脚本扔进去，拿一份 Taprun 兼容的 `.flow.json` 出来：

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
| [`create-tap-script`](https://www.npmjs.com/package/create-tap-script) | （无 — 脚手架） | 从 `<site>/<name> <url>` 生成一个起步 `.flow.json` 信封 |

格式本身有完整文档：[`@taprun/spec`](https://www.npmjs.com/package/@taprun/spec) —— 公共协议接口包：v2 Plan 的 TypeScript 类型（18-op 闭集联合 + 区分式的读/写 Plan 联合）+ JSON Schema 2020-12，其 `$id` 可在 `taprun.dev/spec/plan-v1/schema.json` 解析，并与 TS 类型双向漂移校验。第三方工具（IDE `$schema` 补全、Python/Ruby/Go 中的 ajv 等价校验器、治理层、替代运行时、带 plan 感知权限作用域的 MCP host）都基于此包构建，无需依赖专有的 Taprun 引擎。Plan-v1 规范：[taprun.dev/spec/plan-v1](https://taprun.dev/spec/plan-v1/)。五个包的源码：[`packages/`](packages/)（workspace 总览见 [`packages/README.md`](packages/README.md)）。

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
2. **AI 编译**成 `.flow.json` 程序 — 纯 JSON，18-op 闭集词汇，可版本控制
3. **Taprun 运行**程序 — 两个运行时任选，永久运行，$0

每次成功编译都让下一次更快。要给新网站建 tap？你的 Agent 用 `capture` 按需锻造——不需要目录。

## 已验证判断（Claims Ledger）

**[tap-skills](https://github.com/LeonTing1010/tap-skills)** 不再是 skills 目录——它现在是一份**判断台账**：一条条带日期、可证伪的关于真实网络的判断，每条自带确定性 plan，由 CI **每晚零 token 重放复验**。哪条漂移了，当晚公开翻 🟡。

亲手验证第一条（约 2 分钟，无需登录、无需浏览器）：

```bash
mkdir -p ~/.tap/flows/github
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap-skills/main/claims/2026-07-11-github-trending-has-no-api/plan.json \
  -o ~/.tap/flows/github/trending-no-api.flow.json
npx -y @taprun/cli github/trending-no-api
```

你得到的就是每晚 CI 得到的同一份验证——确定性重放，结果一致。140 条 v1 skills 完整封存在 [`v1-archive`](https://github.com/LeonTing1010/tap-skills/tree/v1-archive) 分支；预制目录只会腐烂，plan 改为按需 `capture` 锻造。

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

最简单的贡献方式：**锻造一个新 tap。** 只需一个 `.flow.json` 文件。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 路线图

- [x] 社区 skills 目录 — 2026-07 退役，改为[判断台账](https://github.com/LeonTing1010/tap-skills)（v1 目录已封存）
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

Chrome 扩展和文档：[MIT](LICENSE)。判断台账：[MIT](https://github.com/LeonTing1010/tap-skills/blob/main/LICENSE)。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)
