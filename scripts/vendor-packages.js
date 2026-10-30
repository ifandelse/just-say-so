#!/usr/bin/env node
// Vendor the bundled Vale packages named in rules/packages.json: download
// each pinned release zip, check its SHA-256, unpack the style into
// styles/<name>/ unchanged, and collect the licences into
// styles/LICENSES.md. Run after moving a pin; the build and the tests
// never touch the network. A package whose sha256 is empty prints the
// checksum it downloaded so the pin can be filled in, and exits 1.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../src/lib/zip.js';
import { readPackages, shippedPackagesPath, styleEntries } from '../src/lib/packages.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stylesDir = path.join(root, 'styles');
const packages = readPackages();

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const licences = ['# Licences of the bundled Vale packages', '', 'The plugin bundles these packages unchanged, under the licences below. The pins are in rules/packages.json.', ''];
let failed = false;
let changed = false;

for (const pkg of packages.packages) {
  const buf = await download(pkg.url);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (!pkg.sha256) {
    console.error(`vendor-packages: ${pkg.name} ${pkg.tag} has no sha256 pinned; the download is ${sha}`);
    failed = true;
    continue;
  }
  if (sha !== pkg.sha256) {
    console.error(`vendor-packages: ${pkg.name} ${pkg.tag} downloaded as ${sha}, pinned ${pkg.sha256}; nothing written`);
    failed = true;
    continue;
  }
  const files = styleEntries(readZip(buf), pkg.name);
  if (files.length === 0) {
    console.error(`vendor-packages: ${pkg.url} holds no style directory named ${pkg.name}`);
    failed = true;
    continue;
  }
  const dir = path.join(stylesDir, pkg.name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(dir, f.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
  }
  const rules = files.filter((f) => f.rel.endsWith('.yml')).length;
  if (pkg.ruleCount !== rules) {
    pkg.ruleCount = rules;
    changed = true;
  }
  const licence = (await download(pkg.licenseUrl)).toString('utf8').trim();
  licences.push(`## ${pkg.name} ${pkg.tag}`, '', `Source: ${pkg.homepage} · ${pkg.license}`, '', '```', licence, '```', '');
  console.log(`vendor-packages: ${pkg.name} ${pkg.tag}: ${rules} rules into ${path.relative(root, dir)}`);
}

if (!failed) {
  fs.writeFileSync(path.join(stylesDir, 'LICENSES.md'), licences.join('\n'));
  if (changed) fs.writeFileSync(shippedPackagesPath(), JSON.stringify(packages, null, 2) + '\n');
}
process.exit(failed ? 1 : 0);
