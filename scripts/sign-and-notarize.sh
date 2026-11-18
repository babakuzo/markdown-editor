#!/usr/bin/env bash
# Sign Notr.app with a Developer ID, package it, then notarize and staple the
# disk image. Run locally with `make notarize`; the release workflow also uses
# it when signing secrets are present.
#
# Required environment:
#   SIGNING_IDENTITY   e.g. "Developer ID Application: Your Name (TEAMID)"
# And either a notarytool keychain profile (simplest on your own Mac):
#   NOTARY_PROFILE     name given to `xcrun notarytool store-credentials`
# Or Apple ID credentials (used by CI):
#   APPLE_ID           Apple ID email used for notarization
#   APPLE_TEAM_ID      10-character team ID
#   APPLE_APP_PASSWORD app-specific password for that Apple ID
#
# Usage: scripts/sign-and-notarize.sh path/to/Notr.app path/to/output.dmg
set -euo pipefail

app="${1:?path to Notr.app}"
dmg="${2:?path to output .dmg}"
: "${SIGNING_IDENTITY:?Set SIGNING_IDENTITY to your Developer ID Application certificate name}"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  auth=(--keychain-profile "$NOTARY_PROFILE")
else
  : "${APPLE_ID:?Set NOTARY_PROFILE, or APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}" "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD}"
  auth=(--apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD")
fi

echo "Signing $app"
codesign --force --deep --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$app"
codesign --verify --strict --verbose=2 "$app"

"$(dirname "$0")/make-dmg.sh" "$app" "$dmg"
codesign --force --timestamp --sign "$SIGNING_IDENTITY" "$dmg"

echo "Notarizing $dmg (this usually takes a few minutes)"
result="$(xcrun notarytool submit "$dmg" "${auth[@]}" --wait 2>&1)" || true
echo "$result"
if ! grep -q "status: Accepted" <<<"$result"; then
  id="$(awk '/^ *id:/ {print $2; exit}' <<<"$result")"
  if [ -n "$id" ]; then
    echo "Notarization was not accepted. Apple's log for submission $id:"
    xcrun notarytool log "$id" "${auth[@]}" || true
  fi
  exit 1
fi

xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature --verbose "$dmg"
shasum -a 256 "$dmg" | sed "s#  .*/#  #" > "$dmg.sha256"
echo "Signed and notarized $dmg"
