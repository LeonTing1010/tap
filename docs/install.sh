#!/bin/sh
set -e

# Tap installer — prefers npm (no Gatekeeper issues on macOS), falls back to
# direct binary download for environments without Node.js.
#
# After the CLI binary lands, this script auto-chains `tap bridge setup` so
# the Chrome extension can reach the CLI immediately. Bridge-setup failure
# is non-fatal — some envs don't have Chrome installed; the user still gets
# a working CLI and clear recovery instructions.

REPO="LeonTing1010/tap"
INSTALL_DIR="$HOME/.tap"

# ── Shared post-install: register Native Messaging bridge + next steps ──

setup_bridge_and_finish() {
  TAP_BIN="$1"
  echo ""
  echo "Tap installed successfully!"
  echo ""
  echo "  binary: ${TAP_BIN}"
  echo ""
  echo "Registering Chrome extension bridge..."
  if "${TAP_BIN}" bridge setup >/dev/null 2>&1; then
    echo "  ✓ Native Messaging manifest registered"
  else
    echo "  ⚠  bridge setup failed (Chrome not installed?) — re-run manually:"
    echo "       ${TAP_BIN} bridge setup"
  fi
  echo ""
  echo "Next steps:"
  echo "  1. Install the Chrome extension (if not yet):"
  echo "       https://chromewebstore.google.com/detail/tap/llcidejeoobdegbkolbjhfoeckphldce"
  echo "  2. Add Tap to your MCP host config (Claude Code / Cursor / Windsurf):"
  echo '       { "mcpServers": { "tap": { "command": "tap" } } }'
  echo "  3. Try it: tap hackernews/hot"
  echo ""
}

# ── Strategy: npm > brew > direct binary ──

# 1. npm (fastest, no Gatekeeper issues)
if command -v npm >/dev/null 2>&1; then
  echo "Installing Tap via npm..."
  npm install -g @taprun/cli@latest 2>&1
  setup_bridge_and_finish "$(which tap)"
  exit 0
fi

# 2. Homebrew (macOS — no Gatekeeper issues)
if command -v brew >/dev/null 2>&1; then
  echo "Installing Tap via Homebrew..."
  brew tap LeonTing1010/tap 2>/dev/null
  brew install taprun 2>&1
  setup_bridge_and_finish "$(which tap)"
  exit 0
fi

# 3. Direct binary download (Linux without npm, or minimal environments)
echo "npm and brew not found — falling back to direct binary download."
echo ""

BIN_DIR="/usr/local/bin"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

# Detect OS
OS=$(uname -s)
case "$OS" in
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

BINARY="tap-${OS}-${ARCH}"
BASE_URL="https://github.com/${REPO}/releases/latest/download"

echo "Installing Tap..."
echo "  platform: ${OS}-${ARCH}"

mkdir -p "$INSTALL_DIR"

# Download binary
echo "  downloading ${BINARY}..."
TMP=$(mktemp -d)
curl -fsSL "${BASE_URL}/${BINARY}" -o "${TMP}/tap"
chmod +x "${TMP}/tap"

# Verify checksum
echo "  verifying checksum..."
curl -fsSL "${BASE_URL}/SHA256SUMS" -o "${TMP}/SHA256SUMS"
EXPECTED_SHA=$(grep "${BINARY}" "${TMP}/SHA256SUMS" | awk '{print $1}')
if [ -z "$EXPECTED_SHA" ]; then
  echo "Error: checksum not found for ${BINARY} in SHA256SUMS"
  exit 1
fi
ACTUAL_SHA=$(shasum -a 256 "${TMP}/tap" | awk '{print $1}')
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "Error: checksum mismatch for ${BINARY}"
  echo "  expected: ${EXPECTED_SHA}"
  echo "  actual:   ${ACTUAL_SHA}"
  exit 1
fi

# macOS: ad-hoc codesign
if [ "$OS" = "macos" ]; then
  xattr -cr "${TMP}/tap" 2>/dev/null || true
  codesign --sign - --force "${TMP}/tap" 2>/dev/null || true
fi

# Install binary
if [ -w "$BIN_DIR" ]; then
  mv "${TMP}/tap" "${BIN_DIR}/tap"
else
  echo "  need sudo to install to ${BIN_DIR}"
  sudo mv "${TMP}/tap" "${BIN_DIR}/tap"
fi

# macOS Sequoia (15+): Gatekeeper may block. Detect and guide user.
if [ "$OS" = "macos" ]; then
  "${BIN_DIR}/tap" config list >/dev/null 2>&1 || {
    echo ""
    echo "  macOS blocked tap (this is normal for first install)."
    echo ""
    echo "  Opening System Settings — click 'Allow Anyway' next to tap, then re-run this installer."
    echo ""
    open "x-apple.systempreferences:com.apple.preference.security" 2>/dev/null || true
    rm -rf "$TMP"
    exit 0
  }
fi

rm -rf "$TMP"

setup_bridge_and_finish "${BIN_DIR}/tap"
