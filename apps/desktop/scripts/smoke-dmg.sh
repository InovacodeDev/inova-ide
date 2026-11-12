#!/bin/zsh
set -euo pipefail

DMG="$1"
EXPECTED_VERSION="$2"
MNT="$(mktemp -d /tmp/inova-smoke.XXXXXX)"
LINK="$(mktemp -u /tmp/inova-bin.XXXXXX)"

cleanup() {
  rm -f "$LINK"
  hdiutil detach "$MNT" -force >/dev/null 2>&1 || true
  rmdir "$MNT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null
APP="$MNT/InovaIDE.app"

codesign --verify --deep --strict "$APP"

SELFTEST_OUT="$(INOVA_SELFTEST=1 "$APP/Contents/MacOS/InovaIDE")"
echo "$SELFTEST_OUT"
echo "$SELFTEST_OUT" | grep -q "selftest:pty-ok:claude,codex,gemini"

ln -s "$APP/Contents/Resources/bin/inova" "$LINK"
CLI_VER="$("$LINK" --version)"
test "$CLI_VER" = "$EXPECTED_VERSION"
"$LINK" --help >/dev/null
