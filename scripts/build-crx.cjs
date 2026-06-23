#!/usr/bin/env node
// Pack extension/ into a signed CRX3 using the pinned signing key.
// Used by both `npm run build:crx` locally and the GitHub release workflow.
//
//   node scripts/build-crx.cjs [keyPath] [crxOutPath]
//
// keyPath defaults to extension-signing-key.pem; crxOutPath to dist/fuse-extension.crx.
const fs = require("fs");
const path = require("path");
const crx3 = require("crx3");

const keyPath = process.argv[2] || "extension-signing-key.pem";
const crxPath = process.argv[3] || "dist/fuse-extension.crx";

if (!fs.existsSync(keyPath)) {
  console.error(`✗ signing key not found: ${keyPath}`);
  console.error("  This is the private key that pins the extension ID; it is gitignored.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(crxPath), { recursive: true });

crx3(["extension/manifest.json"], { keyPath, crxPath })
  .then(() => console.log(`✓ packed signed crx → ${crxPath}`))
  .catch((e) => { console.error("✗ crx pack failed:", e.message); process.exit(1); });
