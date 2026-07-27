#!/usr/bin/env bash
# 打包「可加载已解压」的扩展 zip，用于中国大陆手动分发。
# 产物名固定为 taprun-chrome-extension.zip，与 cn/install.html 里的下载链接一致。
#
# 用法:
#   bash public/extension/cn/pack.sh                 # 输出到扩展目录根
#   bash public/extension/cn/pack.sh /path/out.zip   # 指定输出路径
#
# 排除: 测试/开发产物（test、e2e、node_modules）、文档（*.md）、
#       原型（prototype-popup.html）、本 cn/ 目录自身、macOS 元数据。
# 保留: manifest.json、popup.*、sidepanel.*、background.js、icons/、lib/ 等运行所需文件。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${1:-$EXT_DIR/taprun-chrome-extension.zip}"

cd "$EXT_DIR"
rm -f "$OUT"
zip -rq "$OUT" . \
  -x 'node_modules/*' \
     'e2e/*' \
     'test/*' \
     'cn/*' \
     '*.md' \
     'prototype-popup.html' \
     '.DS_Store' \
     '.git*'

echo "built: $OUT"
unzip -l "$OUT" | grep -E 'manifest.json|background.js|popup.html|icons/' | sed 's/^/  /'
