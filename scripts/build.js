#!/usr/bin/env node
// Render everything the manifest and the package file own: styles/JustSaySo/,
// rules/full.md, rules/condensed.md, and the style sections of
// vale/fallback.ini and .vale.ini. Run after any change to
// rules/manifest.json or rules/packages.json; the drift tests fail until
// you do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyleFiles } from '../src/lib/style-gen.js';
import { renderRules, checkedTerms, shippedManifestPath } from '../src/lib/manifest.js';
import { readPackages, renderValeSections, spliceGenerated } from '../src/lib/packages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(shippedManifestPath(), 'utf8'));
const outDir = path.join(root, 'styles', 'JustSaySo');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const files = buildStyleFiles(manifest);
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), content);
}
fs.writeFileSync(path.join(root, 'rules', 'full.md'), renderRules(manifest, 'full'));
fs.writeFileSync(path.join(root, 'rules', 'condensed.md'), renderRules(manifest, 'condensed'));

// The bundled rules that cover the manifest's banned terms run on code comments too.
const block = renderValeSections(readPackages(), { codeRules: checkedTerms(manifest).map((t) => t.checkedBy) });
const configs = [path.join(root, 'vale', 'fallback.ini'), path.join(root, '.vale.ini')];
for (const file of configs) {
  fs.writeFileSync(file, spliceGenerated(fs.readFileSync(file, 'utf8'), block));
}
console.log(
  `wrote ${Object.keys(files).length} rule files to ${path.relative(root, outDir)}, rules/full.md, rules/condensed.md, and the style sections of ${configs.map((f) => path.relative(root, f)).join(' and ')}`
);
