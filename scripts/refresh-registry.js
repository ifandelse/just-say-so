#!/usr/bin/env node
// Refresh the shipped copy of the Vale package registry, the file Vale
// resolves bare Packages names from. Run on demand before a release; the
// build never touches the network. The advise CLI fetches the live file
// and falls back to this copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_URL, shippedRegistryPath } from '../src/lib/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(15000) });
if (!res.ok) {
  console.error(`refresh-registry: ${REGISTRY_URL} answered ${res.status}`);
  process.exit(1);
}
const entries = await res.json();
if (!Array.isArray(entries) || entries.length < 20) {
  console.error(`refresh-registry: expected a list of 20 or more entries, got ${Array.isArray(entries) ? entries.length : typeof entries}`);
  process.exit(1);
}
fs.writeFileSync(shippedRegistryPath(), JSON.stringify(entries, null, 2) + '\n');
console.log(`wrote ${entries.length} entries to ${path.relative(root, shippedRegistryPath())}`);
