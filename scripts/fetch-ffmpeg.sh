#!/usr/bin/env bash
set -euo pipefail

APP_IDENTIFIER="com.rhaq.aliyaalkids"
RUNTIME_BIN_DIR="$HOME/Library/Application Support/${APP_IDENTIFIER}/runtime/bin"
TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TMP_DIR/ffmpeg.zip"

mkdir -p "$RUNTIME_BIN_DIR"

curl -L "https://evermeet.cx/ffmpeg/getrelease/zip" -o "$ARCHIVE_PATH"
unzip -q "$ARCHIVE_PATH" -d "$TMP_DIR"

mv "$TMP_DIR/ffmpeg" "$RUNTIME_BIN_DIR/ffmpeg"
chmod +x "$RUNTIME_BIN_DIR/ffmpeg"

rm -rf "$TMP_DIR"

echo "ffmpeg installed at: $RUNTIME_BIN_DIR/ffmpeg"
