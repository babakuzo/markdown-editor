#!/usr/bin/env bash
# Package Notr.app into a compressed, drag-to-install disk image.
# Usage: scripts/make-dmg.sh path/to/Notr.app path/to/output.dmg
set -euo pipefail

app="${1:?path to Notr.app}"
dmg="${2:?path to output .dmg}"
name="$(basename "$app" .app)"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"

rm -f "$dmg"
mkdir -p "$(dirname "$dmg")"
hdiutil create \
  -volname "$name" \
  -srcfolder "$stage" \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  "$dmg"

echo "Created $dmg"
