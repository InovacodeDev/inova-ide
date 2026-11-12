#!/bin/sh
set -eu

TAR="$1"
EXPECTED_VERSION="$2"
TMP_DIR="$(mktemp -d /tmp/inova-smoke.XXXXXX)"
LINK_DIR="$(mktemp -d /tmp/inova-bin.XXXXXX)"

cleanup() {
  rm -rf "$TMP_DIR" "$LINK_DIR"
}
trap cleanup EXIT

tar -xzf "$TAR" -C "$TMP_DIR"
APP_BIN="$(find "$TMP_DIR" -maxdepth 3 -name inova-ide -type f | head -n 1)"
test -n "$APP_BIN"
APP_DIR="$(dirname "$APP_BIN")"

SELFTEST_OUT="$(INOVA_SELFTEST=1 xvfb-run -a "$APP_BIN" --no-sandbox)"
echo "$SELFTEST_OUT"
echo "$SELFTEST_OUT" | grep -q "selftest:pty-ok:claude,codex,gemini"

ln -s "$APP_DIR/resources/bin/inova" "$LINK_DIR/inova"
CLI_VER="$("$LINK_DIR/inova" --version)"
test "$CLI_VER" = "$EXPECTED_VERSION"
"$LINK_DIR/inova" --help >/dev/null
