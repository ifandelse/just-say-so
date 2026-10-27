#!/usr/bin/env node
// Set a project up: .vale.ini with the JustSaySo package, vale sync, the
// plugin config for the modes given, the commit gate for the repo's hook
// tooling, then the doctor report. Consent lives with whoever invokes this.
import { runInit } from '../lib/init.js';
import { doctorReport, formatDoctor } from '../lib/doctor.js';

let result;
try {
  result = runInit(process.cwd(), process.argv.slice(2));
} catch (err) {
  console.error(`just-say-so init: ${err.message}`);
  console.error('usage: init.js [--files MODE] [--publish MODE] [--gh] [--mcp PATTERN]... [--reply MODE] [--hook auto|pre-commit|husky|git|none] [--dry-run]');
  process.exit(1);
}
for (const line of result.lines) console.log(`just-say-so init: ${line}`);
console.log('');
process.stdout.write(formatDoctor(doctorReport(result.root)));
