#!/bin/sh
# Build the release zip for the JustSaySo Vale style. Upload the zip to the
# GitHub release so repos can pin it:
#   Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
set -e
cd "$(dirname "$0")/.."
node scripts/build-style.js
rm -f JustSaySo.zip
(cd styles && zip -r ../JustSaySo.zip JustSaySo)
echo "wrote JustSaySo.zip"
