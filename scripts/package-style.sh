#!/bin/sh
# Build the release zip for the JustSaySo Vale package. Upload the zip to
# the GitHub release so repos can pin it:
#   Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
# The zip is a complete package: JustSaySo/.vale.ini plus every style under
# styles/ (JustSaySo, generated from the manifest, and the bundled packages
# the vendor script copied in) and the licences file. The .vale.ini is
# vale/fallback.ini without its StylesPath line (Vale sets the path for a
# package), so a project that lists the package gets the [formats] mapping,
# the style sections, and the per-rule settings merged into its own config
# after `vale sync`.
set -e
cd "$(dirname "$0")/.."
node scripts/build.js
rm -rf JustSaySo.zip build/package
mkdir -p build/package/JustSaySo/styles
grep -v '^StylesPath' vale/fallback.ini > build/package/JustSaySo/.vale.ini
cp -R styles/. build/package/JustSaySo/styles/
(cd build/package && zip -qr ../../JustSaySo.zip JustSaySo)
rm -rf build/package
echo "wrote JustSaySo.zip"
