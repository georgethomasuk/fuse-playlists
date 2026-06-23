#!/usr/bin/env bash
# Build a signed .crx locally — same packer the GitHub release workflow uses.
#
# Usage:  ./scripts/pack.sh [keyPath] [outPath]
#         defaults: extension-signing-key.pem → dist/fuse-extension.crx
#
# Notes:
#  - Signs with the pinned key so the extension ID stays constant
#    (laodgikbbddkkcnblkbcmidmippdfiin) and the redirect URI never changes.
#  - Modern Chrome (stable, macOS/Windows) won't drag-install a non-Web-Store
#    .crx — it appears disabled. Friends "Load unpacked" the extension/ folder;
#    the pinned key keeps the ID stable regardless. This produces a signed,
#    versioned artifact (e.g. for a future self-hosted update feed).
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${1:-extension-signing-key.pem}"
OUT="${2:-dist/fuse-extension.crx}"

if [[ ! -f "$KEY" ]]; then
  echo "✗ signing key '$KEY' not found (it's gitignored — ask George, or regenerate"
  echo "  it, which changes the extension ID and redirect URI)."
  exit 1
fi

# Install the packer on demand if it's not already present.
if ! node -e "require.resolve('crx3')" >/dev/null 2>&1; then
  echo "• installing crx3…"
  npm install
fi

node scripts/build-crx.cjs "$KEY" "$OUT"
