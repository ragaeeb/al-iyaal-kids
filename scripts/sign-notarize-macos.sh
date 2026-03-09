#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CONFIG_PATH="$ROOT_DIR/src-tauri/tauri.conf.json"
BUILD_DIR="$ROOT_DIR/src-tauri/target/release/bundle"
SETUP_NOTARY_SCRIPT="$ROOT_DIR/scripts/setup-notary.sh"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$ROOT_DIR/.logs/sign-notarize/$RUN_ID"
mkdir -p "$LOG_DIR"

log() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

fail() {
  printf '\n[ERROR] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

latest_path() {
  local search_dir="$1"
  local pattern="$2"
  python3 - "$search_dir" "$pattern" <<'PY'
from pathlib import Path
import sys
base = Path(sys.argv[1])
pattern = sys.argv[2]
paths = [path for path in base.glob(pattern) if path.exists()]
if not paths:
    raise SystemExit(1)
latest = max(paths, key=lambda path: path.stat().st_mtime)
print(latest)
PY
}

product_name() {
  python3 - "$TAURI_CONFIG_PATH" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload = json.load(handle)
print(payload.get('productName', 'al-Iyaal Kids'))
PY
}

discover_identities() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p'
}

load_identities() {
  IDENTITIES=()
  while IFS= read -r identity; do
    [[ -n "$identity" ]] || continue
    IDENTITIES+=("$identity")
  done <<EOF_IDENTITIES
$(discover_identities)
EOF_IDENTITIES
}

extract_team_id() {
  python3 - "$1" <<'PY'
import re
import sys
match = re.search(r'\(([A-Z0-9]+)\)\s*$', sys.argv[1])
print(match.group(1) if match else '')
PY
}

validate_notary_profile() {
  local profile_name="$1"
  local team_id="$2"
  xcrun notarytool history \
    --keychain-profile "$profile_name" \
    --team-id "$team_id" \
    --output-format json \
    >"$LOG_DIR/notary-profile-check.json" 2>"$LOG_DIR/notary-profile-check.stderr"
}

build_signed_dmg() {
  local identity="$1"
  log "Building signed DMG using signing identity: $identity"
  (
    cd "$ROOT_DIR"
    APPLE_SIGNING_IDENTITY="$identity" bun run tauri:build -- --bundles dmg
  ) 2>&1 | tee "$LOG_DIR/build.log"
}

verify_artifacts() {
  local app_path="$1"
  local dmg_path="$2"

  if [[ -n "$app_path" && -d "$app_path" ]]; then
    log "Verifying code signature for app bundle"
    codesign --verify --deep --strict --verbose=2 "$app_path" 2>&1 | tee "$LOG_DIR/codesign-verify.log"

    log "Checking Developer ID signature details"
    codesign -dv --verbose=4 "$app_path" 2>&1 | tee "$LOG_DIR/codesign-details.log"

    log "Assessing app bundle with Gatekeeper"
    spctl -a -vv "$app_path" 2>&1 | tee "$LOG_DIR/spctl-app.log" || true
  else
    log "Tauri cleaned the intermediate .app bundle after DMG creation. Skipping app-bundle verification and continuing with DMG notarization."
  fi

  log "Verifying DMG integrity"
  hdiutil verify "$dmg_path" 2>&1 | tee "$LOG_DIR/hdiutil-verify.log"
}

submit_for_notarization() {
  local dmg_path="$1"
  local profile_name="$2"
  local team_id="$3"

  log "Submitting DMG to Apple notarization service"
  xcrun notarytool submit "$dmg_path" \
    --keychain-profile "$profile_name" \
    --team-id "$team_id" \
    --wait \
    --output-format json | tee "$LOG_DIR/notary-submit.json"
}

parse_submission_field() {
  local field_name="$1"
  python3 - "$LOG_DIR/notary-submit.json" "$field_name" <<'PY'
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as handle:
    payload = json.load(handle)
value = payload.get(sys.argv[2], '')
print(value)
PY
}

fetch_notary_log() {
  local submission_id="$1"
  local profile_name="$2"
  local team_id="$3"

  log "Fetching notarization log for submission $submission_id"
  xcrun notarytool log "$submission_id" "$LOG_DIR/notary-log.json" \
    --keychain-profile "$profile_name" \
    --team-id "$team_id"
  cat "$LOG_DIR/notary-log.json"
}

staple_dmg() {
  local dmg_path="$1"
  local app_path="$2"

  if [[ -n "$app_path" && -d "$app_path" ]]; then
    log "Stapling notarization ticket to app bundle"
    xcrun stapler staple -v "$app_path" 2>&1 | tee "$LOG_DIR/stapler-app.log"
    xcrun stapler validate -v "$app_path" 2>&1 | tee "$LOG_DIR/stapler-app-validate.log"
  else
    log "Skipping app-bundle stapling because the intermediate .app is not present."
  fi

  log "Stapling notarization ticket to DMG"
  xcrun stapler staple -v "$dmg_path" 2>&1 | tee "$LOG_DIR/stapler-dmg.log"
  xcrun stapler validate -v "$dmg_path" 2>&1 | tee "$LOG_DIR/stapler-dmg-validate.log"

  log "Assessing stapled DMG with Gatekeeper"
  spctl -a -vv -t install "$dmg_path" 2>&1 | tee "$LOG_DIR/spctl-dmg.log" || true
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "This script must be run on macOS."

  require_cmd bun
  require_cmd codesign
  require_cmd hdiutil
  require_cmd python3
  require_cmd security
  require_cmd spctl
  require_cmd xcrun

  local app_name
  app_name="$(product_name)"

  log "Preparing local signing and notarization for $app_name"
  log "Logs will be written to $LOG_DIR"

  load_identities
  [[ ${#IDENTITIES[@]} -gt 0 ]] || fail "No Developer ID Application identities were found in the login keychain."

  local selected_identity="${APPLE_SIGNING_IDENTITY:-}"
  if [[ -n "$selected_identity" ]]; then
    log "Using APPLE_SIGNING_IDENTITY from environment"
  elif [[ ${#IDENTITIES[@]} -eq 1 ]]; then
    selected_identity="${IDENTITIES[0]}"
    log "Found one signing identity. Auto-selecting it."
  else
    log "Available Developer ID Application identities:"
    local index
    for index in "${!IDENTITIES[@]}"; do
      printf '  [%s] %s\n' "$((index + 1))" "${IDENTITIES[$index]}"
    done
    printf 'Choose signing identity [1-%s]: ' "${#IDENTITIES[@]}"
    read -r selection
    [[ "$selection" =~ ^[0-9]+$ ]] || fail "Invalid identity selection."
    selected_identity="${IDENTITIES[$((selection - 1))]:-}"
    [[ -n "$selected_identity" ]] || fail "Selected identity was out of range."
  fi

  local team_id="${APPLE_TEAM_ID:-${AIYAAL_TEAM_ID:-}}"
  if [[ -z "$team_id" ]]; then
    team_id="$(extract_team_id "$selected_identity")"
  fi
  [[ -n "$team_id" ]] || fail "Unable to derive Apple Team ID from signing identity."

  log "Selected signing identity: $selected_identity"
  log "Derived Team ID: $team_id"

  local default_profile="${AIYAAL_NOTARY_PROFILE:-al-iyaal-kids-notary}"
  local notary_profile="${APPLE_NOTARY_PROFILE:-$default_profile}"
  printf 'Notary keychain profile [%s]: ' "$notary_profile"
  read -r profile_input || true
  if [[ -n "${profile_input:-}" ]]; then
    notary_profile="$profile_input"
  fi

  log "Validating notarytool keychain profile: $notary_profile"
  if ! validate_notary_profile "$notary_profile" "$team_id"; then
    if [[ -t 0 ]]; then
      "$SETUP_NOTARY_SCRIPT" "$notary_profile"
      validate_notary_profile "$notary_profile" "$team_id" || fail "The notarytool keychain profile '$notary_profile' is still not usable after credential setup."
    else
      fail "No usable notarytool profile named '$notary_profile'. Run $SETUP_NOTARY_SCRIPT $notary_profile interactively first."
    fi
  fi

  build_signed_dmg "$selected_identity"

  local app_path=""
  app_path="$(latest_path "$BUILD_DIR/macos" '*.app' 2>/dev/null || true)"
  local dmg_path
  dmg_path="$(latest_path "$BUILD_DIR/dmg" '*.dmg')" || fail "Unable to locate the built .dmg artifact."

  if [[ -n "$app_path" ]]; then
    log "Built app bundle: $app_path"
  fi
  log "Built DMG: $dmg_path"

  verify_artifacts "$app_path" "$dmg_path"
  submit_for_notarization "$dmg_path" "$notary_profile" "$team_id"

  local submission_id
  submission_id="$(parse_submission_field id)"
  local submission_status
  submission_status="$(parse_submission_field status)"
  local status_summary
  status_summary="$(parse_submission_field statusSummary)"

  [[ -n "$submission_id" ]] || fail "Unable to read notary submission id from Apple response."
  fetch_notary_log "$submission_id" "$notary_profile" "$team_id"

  if [[ "$submission_status" != "Accepted" ]]; then
    fail "Notarization did not succeed. Status: ${submission_status:-unknown}. Summary: ${status_summary:-n/a}. See $LOG_DIR/notary-log.json"
  fi

  staple_dmg "$dmg_path" "$app_path"

  log "Signing and notarization completed successfully."
  log "Submission ID: $submission_id"
  log "Final DMG: $dmg_path"
  log "Logs: $LOG_DIR"
}

main "$@"
