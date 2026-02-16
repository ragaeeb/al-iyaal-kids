#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

bun run check
bun run icons:sync
cargo test --manifest-path src-tauri/Cargo.toml
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
