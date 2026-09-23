#!/usr/bin/env node
// Regenerate styles/JustSaySo/ from rules/banned.json. Run after any change
// to the banned list; the style-gen sync test fails when they drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyleFiles } from '../src/lib/style-gen.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const banned = JSON.parse(fs.readFileSync(path.join(root, 'rules', 'banned.json'), 'utf8'));
const outDir = path.join(root, 'styles', 'JustSaySo');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const files = buildStyleFiles(banned);
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), content);
}
console.log(`wrote ${Object.keys(files).length} rule files to ${path.relative(root, outDir)}`);
