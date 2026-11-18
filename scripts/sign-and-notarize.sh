#!/usr/bin/env bash
# Sign Notr.app with a Developer ID, package it, then notarize and staple the
# disk image. Used by the release workflow when signing secrets are present.
#
# Required environment:
#   SIGNING_IDENTITY   e.g. "Developer ID Application: Your Name (TEAMID)"
#   APPLE_ID           Apple ID email used for notarization
#   APPLE_TEAM_ID      10-character team ID
#   APPLE_APP_PASSWORD app-specific password for that Apple ID
#
# Usage: scripts/sign-and-notarize.sh path/to/Notr.app path/to/output.dmg
set -euo pipefail

app="${1:?path to Notr.app}"
dmg="${2:?path to output .dmg}"
: "${SIGNING_IDENTITY:?}" "${APPLE_ID:?}" "${APPLE_TEAM_ID:?}" "${APPLE_APP_PASSWORD:?}"

echo "Signing $app"
codesign --force --deep --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$app"
codesign --verify --strict --verbose=2 "$app"

"$(dirname "$0")/make-dmg.sh" "$app" "$dmg"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$dmg"

echo "Notarizing $dmg (this usually takes a few minutes)"
xcrun notarytool submit "$dmg" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait

xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose "$dmg"
echo "Signed and notarized $dmg"
