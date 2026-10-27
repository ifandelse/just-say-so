#!/usr/bin/env node
// Print the summary of the rejections and events files in the state
// directory. --since takes an ISO date or a span such as 30d or 6w;
// --project narrows to one project path; --json prints the object.
import { eventsFile, readEvents } from '../lib/events.js';
import { rejectionsFile, readRecords } from '../lib/rejections.js';
import { summarize, formatSummary } from '../lib/summary.js';

export function parseSince(value, now = new Date()) {
  if (!value) return null;
  const span = /^(\d+)([dw])$/.exec(value);
  if (span) {
    const days = Number(span[1]) * (span[2] === 'w' ? 7 : 1);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`--since takes an ISO date or a span such as 30d or 6w, not ${value}`);
  return new Date(t).toISOString();
}

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
const report = summarize(readEvents(eventsFile()), readRecords(rejectionsFile()), { since, project: opt('--project') });
process.stdout.write(args.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatSummary(report));
