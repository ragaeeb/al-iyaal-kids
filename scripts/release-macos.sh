#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGN_NOTARIZE_SCRIPT="$ROOT_DIR/scripts/sign-notarize-macos.sh"

cd "$ROOT_DIR"

for argument in "$@"; do
  case "$argument" in
    --help | -h | --preflight)
      exec "$SIGN_NOTARIZE_SCRIPT" "$@"
      ;;
  esac
done

"$SIGN_NOTARIZE_SCRIPT" --preflight "$@"
./scripts/check.sh
exec "$SIGN_NOTARIZE_SCRIPT" "$@"
