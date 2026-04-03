#!/bin/sh
set -e

REPO="LeonTing1010/tap"
INSTALL_DIR="$HOME/.tap"
BIN_DIR="/usr/local/bin"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  arm64|aarch64) ARCH="aarch64" ;;
  x86_64)        ARCH="x86_64" ;;
  *) echo "Unsupported architecture: $ARCH" && exit 1 ;;
esac

# Detect OS
OS=$(uname -s)
case "$OS" in
  Darwin) OS="apple-darwin" ;;
  Linux)  OS="unknown-linux-gnu" ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

BINARY="tap-${ARCH}-${OS}"
TARBALL="${BINARY}.tar.gz"
EXTENSION="tap-extension.zip"

# Get latest release download URL
BASE_URL="https://github.com/${REPO}/releases/latest/download"

echo "Installing Tap..."
echo "  arch: ${ARCH}-${OS}"

# Create directories
mkdir -p "$INSTALL_DIR/extension"

# Download and install binary
echo "  downloading ${TARBALL}..."
TMP=$(mktemp -d)
curl -fsSL "${BASE_URL}/${TARBALL}" -o "${TMP}/${TARBALL}"
tar xzf "${TMP}/${TARBALL}" -C "${TMP}"
chmod +x "${TMP}/${BINARY}"

# Install binary
if [ -w "$BIN_DIR" ]; then
  mv "${TMP}/${BINARY}" "${BIN_DIR}/tap"
else
  echo "  need sudo to install to ${BIN_DIR}"
  sudo mv "${TMP}/${BINARY}" "${BIN_DIR}/tap"
fi

# Download and install extension
echo "  downloading extension..."
curl -fsSL "${BASE_URL}/${EXTENSION}" -o "${TMP}/${EXTENSION}"
unzip -qo "${TMP}/${EXTENSION}" -d "$INSTALL_DIR/extension"

# Cleanup
rm -rf "$TMP"

echo ""
echo "Tap installed successfully!"
echo ""
echo "  binary:    $(which tap)"
echo "  extension: ${INSTALL_DIR}/extension"
echo ""
echo "Next steps:"
echo "  1. Load extension: chrome://extensions/ → Developer mode → Load unpacked → ${INSTALL_DIR}/extension"
echo "  2. Connect to AI agent:"
echo '     { "mcpServers": { "tap": { "command": "tap", "args": ["mcp"] } } }'
echo ""
