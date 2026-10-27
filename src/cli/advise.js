#!/usr/bin/env node
// Print the advice inputs: the summary's situations per project, the
// state of the rules they name, a shortlist of candidate rules per tag
// from installed styles and the package cache, and the registry packages
// the project lacks. --since and --project as for the summary; --json
// prints the object. The registry list is fetched live with a short
// timeout and falls back to the shipped copy; no archive is downloaded.
import { eventsFile, readEvents } from '../lib/events.js';
import { rejectionsFile, readRecords } from '../lib/rejections.js';
import { summarize } from '../lib/summary.js';
import { loadConfig } from '../lib/config.js';
import { loadManifest } from '../lib/manifest.js';
import { fetchRegistry } from '../lib/registry.js';
import { readCache } from '../lib/package-cache.js';
import { adviceInputs, formatAdvice } from '../lib/advise.js';
import { parseSince } from '../lib/since.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};

let since;
try {
  since = parseSince(opt('--since'));
} catch (e) {
  process.stderr.write(`just-say-so advise: ${e.message}\n`);
  process.exit(1);
}

const manifests = new Map();
const manifestFor = (project) => {
  const dir = project ?? process.cwd();
  if (!manifests.has(dir)) manifests.set(dir, loadManifest(loadConfig(dir), dir));
  return manifests.get(dir);
};
const report = summarize(readEvents(eventsFile()), readRecords(rejectionsFile()), { since, project: opt('--project'), manifestFor });
const registry = await fetchRegistry();
const inputs = adviceInputs(report, { registry: registry.entries, cache: readCache() });
inputs.registry = { source: registry.source, error: registry.error };
if (args.includes('--json')) process.stdout.write(JSON.stringify(inputs, null, 2) + '\n');
else {
  process.stdout.write(formatAdvice(inputs));
  if (registry.source === 'shipped') process.stdout.write(`  registry: shipped copy (live fetch failed: ${registry.error})\n`);
}
