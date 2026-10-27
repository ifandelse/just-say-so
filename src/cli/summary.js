#!/usr/bin/env node
// Print the summary of the rejections and events files in the state
// directory. --since takes an ISO date or a span such as 30d or 6w;
// --project narrows to one project path; --json prints the object.
import { eventsFile, readEvents } from '../lib/events.js';
import { rejectionsFile, readRecords } from '../lib/rejections.js';
import { summarize, formatSummary } from '../lib/summary.js';
import { loadConfig } from '../lib/config.js';
import { loadManifest } from '../lib/manifest.js';
import { parseSince } from '../lib/since.js';


const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
let since;
try {
  since = parseSince(opt('--since'));
} catch (err) {
  console.error(`just-say-so summary: ${err.message}`);
  process.exit(1);
}
// Each project's own manifest decides what its tags cover, because a
// project's rules.extra adds bullets no other project has. A record with
// no project falls back to the launch directory's manifest.
const manifests = new Map();
const manifestFor = (project) => {
  const dir = project ?? process.cwd();
  if (!manifests.has(dir)) manifests.set(dir, loadManifest(loadConfig(dir), dir));
  return manifests.get(dir);
};
const report = summarize(readEvents(eventsFile()), readRecords(rejectionsFile()), {
  since,
  project: opt('--project'),
  manifestFor
});
process.stdout.write(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatSummary(report));
