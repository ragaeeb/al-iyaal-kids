#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/assets/bin"
TARGET_PATH="$TARGET_DIR/yap.sh"

mkdir -p "$TARGET_DIR"

cat > "$TARGET_PATH" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

if command -v yap >/dev/null 2>&1; then
  exec "$(command -v yap)" "$@"
fi

echo "yap CLI is required but not installed. Install with: brew install finnvoor/tools/yap" >&2
exit 127
WRAPPER

chmod +x "$TARGET_PATH"
# Remove legacy wrapper name that causes tauri resource-copy issues.
rm -f "$TARGET_DIR/yap"
echo "Synced yap wrapper sidecar to $TARGET_PATH"
