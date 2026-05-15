<!--
DRAFT for InfoQ submission. Jekyll skips _drafts/ by default — won't deploy.

SUBMISSION METADATA (paste into InfoQ author form fields):

  Title:          AI Agent 撞上"请先登录"：被忽略的浏览器 MCP 分类
  Tags:           AI Agent · MCP · 浏览器自动化 · 本地优先 · 工程实践
  Category:       AI & ML / Agent
  Author display: LeonTing
  Canonical URL:  https://taprun.dev/blog/authenticated-browser-mcp.html
  Original date:  2026-04-22 (English) · 2026-05-14 (中文版)
  Word count:     ~2200 字
  Reading time:   ~8 分钟

  Excerpt (摘要 / 用于列表页 + RSS):
    本周 InfoQ 头条有 4 篇都在讨论 AI Agent 安全，但有一个更具体的架构问题被几乎所有
    MCP 浏览器工具集体回避：它们看不见你登录的账号。当你让 Claude Code 汇总公众号
    后台、导出 HubSpot、查招行余额——MCP 浏览器工具会新开一个 Chromium 实例，告诉
    你"请先登录"。这不是某个工具的缺陷，是云端浏览器在结构上无法逾越的认证墙。

NOTE: Per CLAUDE.md content rules: do NOT add "OSS" / "open-source" framing to Tap
itself (tap-core is closed-source / proprietary). Safe phrasing: "本地优先"、"v0.x
期间免费可用"、"开源社区 taps"、"浏览器扩展开源"。
-->

# AI Agent 撞上"请先登录"：被忽略的浏览器 MCP 分类

> 你的浏览器是登录的；Claude 的浏览器不是。

本周 InfoQ 头条里有 4 篇都在讨论 AI Agent 安全：流量隔离、CI/CD 工作流安全、攻击入口、沙箱治理。讨论很热，但有一个更具体的架构问题被几乎所有 MCP 浏览器工具集体回避了：

**这些工具看不见你登录的账号。**

当你让 Claude Code 汇总公众号后台的待审稿件、从 HubSpot 导出本周成交、查询招商银行余额、扫描内部 staging dashboard——它会调起 MCP 浏览器工具，新开一个 Chromium 实例，导航到目标 URL，然后告诉你：请先登录。

这不是某个工具的缺陷。这是一类工具的架构盲区。

## 主流 MCP 浏览器工具实际能做什么

去 GitHub 拉它们的源码，读一下每个 `browser_navigate` / `browser_extract` 背后到底跑了什么：

| 工具 | 浏览器跑在哪 | 会话状态 | 能访问你登录的 Shopify? |
|---|---|---|---|
| Playwright MCP | 新开 Chromium，每会话独立 | 空——无 cookie、无 localStorage、无 IndexedDB | ❌ |
| BrowserBase MCP | 托管在他们云上的 Chromium | 空——他们基础设施上的匿名浏览器 | ❌ |
| Firecrawl MCP | 服务端 crawler | 仅公开 web——只能看到匿名访客可见的内容 | ❌ |
| Stagehand (MCP 包装) | 新开 Playwright 实例 | 空——除非你手动注入 cookie | ❌ |
| Bardeen 类 Chrome 扩展 | ✅ 你的 Chrome | ✅ 你真实的会话 | ✅——但没有 MCP 接口，只能可视化操作 |

四个技术成熟的工具，对"你真实工作流 90% 在用的地方"——SaaS 账号、供应商门户、内部 dashboard、邮箱——**结构性失明**。

## 为什么是架构盲区，不是 bug

云端浏览器工具没法靠"加个 login 功能"补上这个空洞，原因都是结构性的：

### 1. Cookie 不能合法/安全地搬到云端浏览器

你 `shopify.com` 的 session cookie 是绑定到你设备的认证凭据。哪怕云端服务真问你要，你递过去就等于把这家网站的访问令牌交给了第三方。这种 liability 用户不想要，云端 vendor 更不想要——后者要承担"我们的服务器存了几百万用户的 session token"的合规和安全责任。

有些工具尝试绕开这一点——让你在他们那里登一次。但这样他们就持有了你的凭据。同样的问题，换了个洗法。

### 2. 浏览器指纹会出卖云端来源

很多服务——Google、LinkedIn、绝大部分银行、大多数 SaaS 的 SSO——会标记来自陌生 IP / 设备指纹的登录。一个跑在 AWS 上的浏览器会触发 2FA、设备验证、或者直接被封，哪怕你不知怎么共享了正确的 cookie 进去。

唯一不会触发这些机制的指纹，是你**自己机器上**那一个。

### 3. 2FA 和会话续签需要你本人在场

就算 cookie 能用、指纹也没出问题，session 到期续签会问 TOTP 或者推送设备确认。云端浏览器答不上来；坐在云端浏览器主人桌前的那个人也答不上来——因为他不在那个浏览器前。

三条叠加是一堵硬墙：**云端浏览器在结构上无法稳定地操作真实用户的认证账号**——投多少工程都补不上。

## 真正的 AI Agent 工作流，绝大部分在登录态后面

把人们真正希望 Claude Code / Cursor / Cline 等 Agent 跑的自动化列一遍，需要登录的占绝对多数：

- **"每天早上把待审稿件摘要发到飞书"**——公众号后台需要登录
- **"把本周成交客户从 HubSpot 同步到 Notion"**——HubSpot 需要登录
- **"查招行/Wise 余额，低于 X 就告警"**——银行需要登录
- **"从三个供应商门户下载 PDF 发票"**——供应商门户需要登录
- **"读 Gmail 里的合同邮件，提炼履约义务"**——Gmail 需要登录
- **"看一眼 staging 环境部署的是不是最新 commit"**——公司内部 dashboard 需要登录
- **"从 Intercom 拉活跃对话路由进 CRM"**——Intercom 需要登录

以上没有一个能被 Playwright MCP、BrowserBase MCP 或 Firecrawl MCP 解决。不是因为它们不好——**它们各自领域都是顶尖的工具**，但它们能做的事是在公开 web 或一个全新沙箱上跑，而你的真实工作在登录态后面。

这正好对应本周 InfoQ 那 4 篇 Agent 安全文章的另一面：**讨论"Agent 不能做什么坏事"之前，先要问"Agent 能不能做对的事"**。如果 Agent 连你登录的后台都看不见，它的攻击面争论也只是在一个非常窄的、公开 web 的 sandbox 上发生。

## 被忽略的分类：认证浏览器 MCP (authenticated browser MCP)

这是一个有清晰边界的分类，要求也很具体：

- 跑在用户自己的 Chrome（或用户自己机器上的 Playwright，如果用 Chromium-based profile）
- 操作用户真实的会话——**已经在那里的** cookie / localStorage / IndexedDB
- 通过 MCP 协议暴露给 AI agent，不是 Bardeen / PhantomBuster 那种只能可视化操作的工具
- **不把用户数据发到任何云端**——blast radius 锁死在用户本地设备
- 输出**可复用、可审计、可版本化**的自动化程序，不是一次性动作

目前满足全部条件的 MCP server 只有一个：**Tap**。不是因为 Tap 聪明——是因为这些架构约束逼出了这个形态，而没有别的项目从这些约束出发去做。

## Tap 怎么填这个空位

Tap 是一个 MCP server，提供四个 meta 动词：`capture / verify / mark / run`，做三件事：

1. **`capture`**："追踪我公众号后台的待审稿件" → AI 探查 `mp.weixin.qq.com` 的结构，找到最稳定的数据源（API 端点 / ARIA landmark / Schema.org markup / 可用的 RSS），编译出一个**只读取最稳定来源**的确定性 Plan。运行时**没有任何 LLM 调用**。
2. **`run`**：Plan 在你本地 Chrome 里跑（也可以切换到你本机的 Playwright 或 macOS native），使用你真实的会话。你的 2FA 状态、设备指纹、cookie——全都已经在那儿，因为它**就是你的浏览器**。
3. **`verify`**：当站点结构发生会让 Plan 失效的漂移时，Tap 能在你的数据出错之前检测出来。不是泛泛的"脚本崩了"信号——是知道 Plan 原本应该读什么的**结构化漂移检测器**。

第 2 步是云端竞品无法复制的，因为约束就在这里。第 1 步和第 3 步可以复制，但第 2 步无法。

Plan 的格式是 `.plan.json`——一个 11 个 op 的闭包并集（fetch / nav / wait / input / extract / cookies / tap / if / foreach / parallel / eval），bare JSON，[规范开源](https://taprun.dev/spec/plan-v1/)、可 diff、可 git 化、可被任何兼容运行时执行。AI 在编译期参与一次，运行期是纯数据 + dispatch，单次重放成本 ≈ \$0.003（仅本地浏览器算力）。

## 什么时候 cloud browser MCP 是对的选择

需要明确：云端浏览器 MCP 工具不是"次等品"，是另一种专门化：

- **Firecrawl** 是 RAG pipeline 大规模抓公开内容的最佳选择
- **BrowserBase** 是不想占用本地机器跑批量公开 web 自动化的最佳选择
- **Playwright MCP** 是在干净状态浏览器上测试自己 web app 的最佳选择

目标数据是**公开的**——用云端；目标数据**在你的登录态后面**——用认证浏览器 MCP。这是两类问题，不是同类问题的好坏选择。

## 试一下

如果你用 Claude Code 或 Cursor 撞过"请先登录"那道墙，可以装一下 Tap：

```bash
# 60 秒安装
curl -fsSL https://taprun.dev/install.sh | bash
tap mcp start    # 把 MCP host (Claude Code / Cursor / Cline / Continue) 指向这条命令
```

然后让 Claude Code 在上面列的任何一个登录态任务上调 `capture`。Tap 会用你的登录态去探查，编译出一个确定性 Plan。这个 plan 是你的——存在 `~/.tap/plans/<site>/<name>.plan.json`，可以审、可以 diff、可以 0-token 重复运行，站点变化时 `tap verify` 会检测漂移。

**v0.x 期间所有功能免费**，包括 AI 辅助 capture、verify、社区维护的 taps。付费层次尚未启用，未来引入也会保留 100% 本地模式（per 项目 ADR 2026-05-04-paid-tier-deferred）。

如果 Claude Code 总在你面前撞登录墙，这堵墙不会消失——云端 MCP 工具结构上在墙的另一侧。Tap 在你这一侧。

---

*本文原文 [The authenticated browser MCP: why cloud tools can't see your logged-in state](https://taprun.dev/blog/authenticated-browser-mcp.html) 首发于 taprun.dev，2026-04-22。中文版由作者翻译并针对中文技术读者本地化，2026-05-14。*
