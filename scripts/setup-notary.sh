#!/usr/bin/env bash
set -euo pipefail

PROFILE_NAME="${1:-${AIYAAL_NOTARY_PROFILE:-al-iyaal-kids-notary}}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

detect_team_id() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*Developer ID Application: .* (\([A-Z0-9][A-Z0-9]*\)).*/\1/p' \
    | head -n 1
}

require_cmd xcrun
require_cmd security

STORE_ARGS=()
TEAM_ID="${APPLE_TEAM_ID:-${AIYAAL_TEAM_ID:-$(detect_team_id)}}"

if [[ -n "${AIYAAL_ASC_KEY_PATH:-}" && -n "${AIYAAL_ASC_KEY_ID:-}" ]]; then
  STORE_ARGS+=(--key "$AIYAAL_ASC_KEY_PATH" --key-id "$AIYAAL_ASC_KEY_ID")
  if [[ -n "${AIYAAL_ASC_ISSUER:-}" ]]; then
    STORE_ARGS+=(--issuer "$AIYAAL_ASC_ISSUER")
  fi
else
  if [[ -n "${AIYAAL_APPLE_ID:-}" ]]; then
    STORE_ARGS+=(--apple-id "$AIYAAL_APPLE_ID")
  fi
  if [[ -n "$TEAM_ID" ]]; then
    STORE_ARGS+=(--team-id "$TEAM_ID")
  fi
  if [[ -n "${AIYAAL_APP_SPECIFIC_PASSWORD:-}" ]]; then
    STORE_ARGS+=(--password "$AIYAAL_APP_SPECIFIC_PASSWORD")
  fi
fi

echo "Storing notarization credentials in Keychain profile: $PROFILE_NAME"
echo "If required values are not already available from env, notarytool will prompt for them."
if [[ -n "$TEAM_ID" ]]; then
  echo "Auto-detected Team ID: $TEAM_ID"
fi

if [[ ${#STORE_ARGS[@]} -gt 0 ]]; then
  xcrun notarytool store-credentials "$PROFILE_NAME" --validate "${STORE_ARGS[@]}"
else
  xcrun notarytool store-credentials "$PROFILE_NAME" --validate
fi

echo "Stored notarization credentials in profile: $PROFILE_NAME"
