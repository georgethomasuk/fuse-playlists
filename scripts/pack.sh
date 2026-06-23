#!/usr/bin/env bash
# Pack the extension into a signed .crx using the pinned signing key.
#
# Usage:  ./scripts/pack.sh [/path/to/Google\ Chrome]
#
# Notes:
#  - The .crx is signed with extension-signing-key.pem so the extension ID stays
#    constant (laodgikbbddkkcnblkbcmidmippdfiin) and the redirect URI never changes.
#  - Modern Chrome (stable, macOS/Windows) will NOT let friends drag-install a
#    non-Web-Store .crx — it appears disabled. For now, friends "Load unpacked"
#    the extension/ folder; the pinned key in manifest.json keeps the ID stable
#    regardless. This script exists to produce a signed, versioned artifact.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="extension-signing-key.pem"
SRC="extension"
OUT="dist"

if [[ ! -f "$KEY" ]]; then
  echo "✗ $KEY not found. This is the private signing key — ask George for it, or"
  echo "  regenerate (which changes the extension ID and redirect URI)."
  exit 1
fi

# Locate Chrome
CHROME="${1:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "✗ Chrome not found at: $CHROME"
  echo "  Pass the path as the first argument."
  exit 1
fi

mkdir -p "$OUT"
"$CHROME" --pack-extension="$PWD/$SRC" --pack-extension-key="$PWD/$KEY" --no-message-box
# Chrome writes extension.crx next to the source dir
mv -f "${SRC}.crx" "$OUT/fuse-extension.crx"
echo "✓ Packed → $OUT/fuse-extension.crx"
