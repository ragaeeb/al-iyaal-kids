#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PYTHONPATH="$PROJECT_DIR/src" uv run --project "$PROJECT_DIR" --extra dev python -m pytest "$PROJECT_DIR/tests"
