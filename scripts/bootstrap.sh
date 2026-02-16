#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install from https://bun.sh"
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust toolchain is required. Install from https://rustup.rs"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required for Python worker setup. Install from https://docs.astral.sh/uv/"
  exit 1
fi

cd "$ROOT_DIR"

bun install
cargo fetch --manifest-path src-tauri/Cargo.toml
uv sync --project python-worker --extra dev

echo "Bootstrap complete."
