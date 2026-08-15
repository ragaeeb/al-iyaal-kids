#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/assets/bin"
TARGET_PATH="$TARGET_DIR/yap.sh"
TEMP_PATH="$(mktemp)"

cleanup() {
  rm -f "$TEMP_PATH"
}
trap cleanup EXIT

mkdir -p "$TARGET_DIR"

cat > "$TEMP_PATH" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

if command -v yap >/dev/null 2>&1; then
  exec "$(command -v yap)" "$@"
fi

echo "yap CLI is required but not installed. Install with: brew install finnvoor/tools/yap" >&2
exit 127
WRAPPER

if ! cmp -s "$TEMP_PATH" "$TARGET_PATH"; then
  install -m 755 "$TEMP_PATH" "$TARGET_PATH"
  echo "Synced yap wrapper sidecar to $TARGET_PATH"
else
  echo "Yap wrapper sidecar already current."
fi

# Remove legacy wrapper name that causes tauri resource-copy issues.
rm -f "$TARGET_DIR/yap"
