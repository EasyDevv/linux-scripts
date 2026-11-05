#!/usr/bin/env bash
# smoke.sh: run each droid command once against the medium_phone emulator on the bench adb server
# (port 5038, mdns off), so the real phone on the default server (5037) is never touched.
# Usage: smoke.sh [avd]   Starts the AVD when none is booted and stops what it started.
set -euo pipefail

readonly avd="${1:-medium_phone}"
readonly emulator_bin="${ANDROID_HOME:-/opt/android-sdk}/emulator/emulator"
export ANDROID_ADB_SERVER_PORT=5038 ADB_MDNS=0

here="$(cd "$(dirname "$0")" && pwd)"
go build -C "$here" -o "$here/bin/droid" .
droid="$here/bin/droid"
started=""
work="$(mktemp -d)"

cleanup() {
  if [[ -n "$started" ]]; then
    adb -P 5038 emu kill >/dev/null 2>&1 || kill "$started" 2>/dev/null || true
  fi
  adb -P 5038 kill-server >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

adb start-server >/dev/null
if ! adb devices | grep -q '^emulator-.*device$'; then
  "$emulator_bin" -avd "$avd" -no-window -no-audio -no-snapshot-save -gpu swiftshader_indirect \
    >"$work/emulator.log" 2>&1 &
  started=$!
  adb wait-for-device
fi
for _ in $(seq 120); do
  [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && break
  sleep 2
done
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$k" 0
done
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true

pass=0
step() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    pass=$((pass + 1))
    printf 'ok   %-8s %s\n' "$name" "$(head -1 <<<"$out")"
  else
    printf 'FAIL %-8s (exit %d)\n%s\n' "$name" "$?" "$out"
    exit 1
  fi
}

model="$(adb shell getprop ro.product.model | tr -d '\r')"
S=(--model "$model")
check_dump() { "$droid" dump "${S[@]}" | grep -q '</hierarchy>'; }
check_rec() {
  "$droid" rec start --segment 5 "${S[@]}" --json >/dev/null
  sleep 12
  "$droid" rec stop --dir "$work/rec" "${S[@]}" --json | grep -q '"segments":\[{'
  [[ "$(find "$work/rec" -name 'seg-*.mp4' | wc -l)" -ge 2 ]]
}
check_awake() {
  local before after
  before="$(adb shell settings get system screen_off_timeout | tr -d '\r')"
  "$droid" awake --idle 2m "${S[@]}" --json >/dev/null
  "$droid" rest "${S[@]}" --json | grep -q '"restored":true'
  after="$(adb shell settings get system screen_off_timeout | tr -d '\r')"
  [[ "$before" == "$after" ]]
}

step version "$droid" version --json
step connect "$droid" connect
step serial "$droid" serial "${S[@]}" --json
step state "$droid" state "${S[@]}"
step lock "$droid" lock "${S[@]}" --json
step look "$droid" look "${S[@]}" --quiet
step dump check_dump
step text "$droid" dump --text "${S[@]}"
check_uiauto() { DROID_NODEDUMP=off "$droid" dump "${S[@]}" | tail -c 20 | grep -q '</hierarchy>'; }
step uiauto check_uiauto
step nodes "$droid" rest --nodes "${S[@]}" --json
step key "$droid" key HOME "${S[@]}" --no-look --json
step tap "$droid" tap 540,1200 "${S[@]}" --json
step swipe "$droid" swipe 540,1800 540,600 300 "${S[@]}" --json
step type "$droid" type "한글 smoke" "${S[@]}" --no-look --json
step key2 "$droid" key HOME "${S[@]}" --no-look
step awake check_awake
step overlay "$droid" overlay hide "${S[@]}" --json
step restore "$droid" overlay restore "${S[@]}" --json
step shot "$droid" shot "$work/s.png" "${S[@]}" --json
step rec check_rec
step adb "$droid" adb "${S[@]}" -- shell echo ok

echo "smoke: $pass passed"
