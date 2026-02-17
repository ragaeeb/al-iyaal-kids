#!/usr/bin/env bash
set -euo pipefail

if command -v yap >/dev/null 2>&1; then
  exec "$(command -v yap)" "$@"
fi

echo "yap CLI is required but not installed. Install with: brew install finnvoor/tools/yap" >&2
exit 127
