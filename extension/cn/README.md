# Taprun 大陆分发（消费者路径）

Chrome 网上应用店与 `taprun.dev` 在中国大陆均不可达，但 Taprun 的扩展与引擎都能在本地正常运行。
本目录提供**不依赖被屏蔽站点**的手动安装通道，面向个人消费者。

## 包含内容

| 文件 | 作用 |
|---|---|
| `install.html` | 自包含中文安装引导页（不加载任何外部 CSS/字体/统计脚本，可纯静态部署） |
| `pack.sh` | 把扩展目录打成 `taprun-chrome-extension.zip`，用于「加载已解压」分发 |
| `README.md` | 本文件 |

## 安装链路（为什么能通）

| 环节 | 大陆通道 |
|---|---|
| 扩展包下载 | GitHub Releases，经 `ghproxy.com` 代理（见 `install.html` 步骤 1 链接） |
| 引擎安装 | npm 国内镜像 `registry.npmmirror.com`（`npx --registry … @taprun/cli embed`） |
| 引擎运行 | 本地 Native Messaging，无外联，正常 |

## 部署方式（GitHub 托管）

1. **安装页**：将 `install.html` 作为静态页部署。最简：放进一个 GitHub Pages 仓库（如
   `LeonTing1010/taprun-cn`），或挂到任意国内可达的静态托管前加 CDN。
   - ⚠️ **可达性提醒**：GitHub Pages / raw 在大陆常被墙或极慢。若面向大陆用户，
     建议在本页前加一层国内可达的 CDN/反代；页面本身已零外部依赖，镜像成本低。
2. **扩展 zip**：运行 `bash public/extension/cn/pack.sh`，把产出的
   `taprun-chrome-extension.zip` 作为 GitHub Release 资产发布（用 `latest` 标签，
   与 `install.html` 里的下载链接对应）。
3. **引擎镜像**：无需额外操作——`install.html` 已写死走 `registry.npmmirror.com`。

## 已知缺口（后续可补）

- **popup 内链接仍指向 `taprun.dev`**：大陆用户从本页装好扩展后，popup 里的
  「Set up Taprun / Learn more / Wire an agent」链接在大陆打不开。可在 `popup.js` /
  常量里增加「镜像域名」概念（如 `MIRROR_BASE`），让国内用户在 popup 内也走可达地址。
  这属于扩展代码改动，未在本目录范围内实现。
- **企业强制安装**（组策略 / MDM 静默安装 `.crx`）本期未做；如需要再补
  `ExtensionInstallForcelist` 模板与自签名 `.crx` 流程。
- **页面文案与 `install.html`（海外版）需保持同步**：命令以 CLI 实际子命令为准
  （`bridge setup` / `bridge status` / `embed` / `ls` / `run` 均为真实命令）。
