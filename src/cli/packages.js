#!/usr/bin/env node
// The package cache. No arguments: report it against the registry.
// --refresh [names...]: download every style package in the registry, or
// the named ones, and write their rule facts. --prune: remove cached
// packages the registry no longer lists. --json prints the status object.
import { fetchRegistry } from '../lib/registry.js';
import { cacheStatus, refreshPackages, prunePackages, formatCacheStatus } from '../lib/package-cache.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const registry = await fetchRegistry();
const source = registry.source === 'live' ? 'live' : `shipped copy (live fetch failed: ${registry.error})`;

if (args.includes('--refresh')) {
  const names = args.slice(args.indexOf('--refresh') + 1).filter((a) => !a.startsWith('--'));
  const result = await refreshPackages(registry.entries, names);
  if (!json) {
    for (const r of result.refreshed) process.stdout.write(`refreshed ${r.name}: ${r.rules} rules${r.unreadable ? ` (${r.unreadable} messages the parser could not read)` : ''}\n`);
    for (const f of result.failed) process.stdout.write(`failed ${f.name}: ${f.error}\n`);
  }
  if (json) process.stdout.write(JSON.stringify({ ...result, status: cacheStatus(registry.entries), registry: source }, null, 2) + '\n');
  else process.stdout.write(formatCacheStatus(cacheStatus(registry.entries), { source }));
  process.exit(result.failed.length ? 1 : 0);
}

if (args.includes('--prune')) {
  const removed = prunePackages(registry.entries);
  if (!json) process.stdout.write(removed.length ? `removed ${removed.join(', ')}\n` : 'nothing to prune\n');
}

const status = cacheStatus(registry.entries);
if (json) process.stdout.write(JSON.stringify({ ...status, registry: source }, null, 2) + '\n');
else process.stdout.write(formatCacheStatus(status, { source }));
