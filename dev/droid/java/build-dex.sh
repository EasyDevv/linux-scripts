#!/usr/bin/env bash
# build-dex.sh: rebuild nodedump.dex from NodeDump.java (run after editing it; the dex is embedded
# in droid (../main.go) by go:embed, so `go build` follows). Needs javac and the Android SDK (platform + d8).
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
JAR=$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)
D8="$SDK/cmdline-tools/latest/bin/d8"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
javac -nowarn --release 8 -cp "$JAR" -d "$out" NodeDump.java 2>&1 | grep -v '^warning\|^Note\|^1 warning' || true
"$D8" --min-api 26 --lib "$JAR" --output "$out" "$out"/NodeDump*.class
cp "$out/classes.dex" nodedump.dex
echo "nodedump.dex $(stat -c %s nodedump.dex) bytes"
