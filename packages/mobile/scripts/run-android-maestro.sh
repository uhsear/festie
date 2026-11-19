#!/usr/bin/env bash

set -u

adb install -r packages/mobile/android/app/build/outputs/apk/release/app-release.apk || exit $?
adb logcat -c || exit $?
cd packages/mobile || exit $?

# Runs one flow with a single retry. The first flow keeps the original report and
# debug paths (the screenshot-coverage step reads them); later flows get their own.
run_flow() {
  local flow=$1 report=$2 debug_dir=$3 attempt rc=1
  for attempt in 1 2; do
    MAESTRO_CLI_NO_ANALYTICS=1 maestro test \
      -e TEST_USERNAME="${TEST_USERNAME:-}" \
      -e TEST_PASSWORD="${TEST_PASSWORD:-}" \
      --test-output-dir="$debug_dir" \
      --debug-output="$debug_dir" \
      --flatten-debug-output \
      --format junit --output "$report" \
      ".maestro/$flow.yaml"
    rc=$?
    [ "$rc" -eq 0 ] && break

    if [ "$attempt" -lt 2 ]; then
      echo "::warning::Maestro $flow attempt $attempt failed (rc=$rc) — retrying once after 20 s"
      sleep 20
      adb logcat -c
    fi
  done
  return "$rc"
}

maestro_rc=0
note_failure() {
  [ "$1" -eq 0 ] || maestro_rc=$1
}

run_flow android-smoke maestro-report.xml "$PWD/maestro-debug"
note_failure $?
run_flow authgate-guard-verify maestro-report-authgate-guard-verify.xml "$PWD/maestro-debug/authgate-guard-verify"
note_failure $?

# These two flows sign in, so they need the smoke account. Skip cleanly without it.
if [ -n "${TEST_USERNAME:-}" ] && [ -n "${TEST_PASSWORD:-}" ]; then
  for flow in account-session sos-fab-verify; do
    run_flow "$flow" "maestro-report-$flow.xml" "$PWD/maestro-debug/$flow"
    note_failure $?
  done
else
  echo "TEST_USERNAME/TEST_PASSWORD not set: skipping account-session and sos-fab-verify"
fi

adb logcat -d ReactNativeJS:V AndroidRuntime:E ReactNative:W '*:S' > logcat-rn.txt || true
# Full warning-level log and the last screen, so a launch that never reaches the
# first screen can be diagnosed from the artifacts.
adb logcat -d '*:W' > logcat-all.txt || true
adb exec-out screencap -p > final-screen.png || true
exit "$maestro_rc"
