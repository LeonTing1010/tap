#!/bin/sh
set -e

REPO="LeonTing1010/tap"
INSTALL_DIR="$HOME/.tap"
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
EXTENSION="tap-extension.zip"

# Get latest release download URL
BASE_URL="https://github.com/${REPO}/releases/latest/download"

echo "Installing Tap..."
echo "  platform: ${OS}-${ARCH}"

# Create directories
mkdir -p "$INSTALL_DIR/extension"

# Download binary (release assets are raw binaries, not tarballs)
echo "  downloading ${BINARY}..."
TMP=$(mktemp -d)
curl -fsSL "${BASE_URL}/${BINARY}" -o "${TMP}/tap"
chmod +x "${TMP}/tap"

# Install binary
if [ -w "$BIN_DIR" ]; then
  mv "${TMP}/tap" "${BIN_DIR}/tap"
else
  echo "  need sudo to install to ${BIN_DIR}"
  sudo mv "${TMP}/tap" "${BIN_DIR}/tap"
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
echo "  2. Install community taps: tap update"
echo "  3. Try it: tap hackernews hot"
echo ""
