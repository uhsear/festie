#!/usr/bin/env bash
set -euo pipefail

# Publish a JS-only OTA update from packages/mobile, refusing to publish an iOS
# update that hides sign-in.
#
# app.config.js bakes extra.appleSignIn and extra.googleSignIn into the update
# manifest from FESTIE_APPLE_SIGNIN and GOOGLE_IOS_URL_SCHEME. If either is unset
# in the shell that runs `eas update`, the OTA turns Apple or Google sign-in off on
# builds that have it. Set them in the shell, never in EAS env.
#
# Usage:
#   bash ota.sh --check                      check the flags only (dry run)
#   bash ota.sh <branch> "<update message>"  check the flags, then publish
#
# mobile-ota.yml runs `bash ota.sh --check` before it publishes.

check_flags() {
  local missing=0
  if [ "${FESTIE_APPLE_SIGNIN:-}" != "1" ]; then
    echo "ERROR: FESTIE_APPLE_SIGNIN is not 1 -- this OTA would hide Apple sign-in. Export FESTIE_APPLE_SIGNIN=1." >&2
    missing=1
  fi
  if [ -z "${GOOGLE_IOS_URL_SCHEME:-}" ]; then
    echo "ERROR: GOOGLE_IOS_URL_SCHEME is empty -- this OTA would hide Google sign-in. Export the reversed iOS client ID (the value the iOS build used)." >&2
    missing=1
  fi
  return "$missing"
}

case "${1:-}" in
  --check)
    check_flags
    echo "OK: sign-in flags are set"
    ;;
  "")
    echo "Usage: bash ota.sh --check | bash ota.sh <branch> \"<message>\"" >&2
    exit 2
    ;;
  *)
    [ -n "${2:-}" ] || { echo "Usage: bash ota.sh <branch> \"<message>\"" >&2; exit 2; }
    check_flags
    exec npx eas-cli update --branch "$1" --message "$2" --non-interactive
    ;;
esac
