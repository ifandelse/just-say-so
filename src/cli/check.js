#!/usr/bin/env node
// Run the banned-term checker on files or stdin ("-"). Exit 0 clean, 1
// banned terms found, 2 usage or read errors. bannedCheck.mode is ignored —
// this command reports and sets the exit code; the caller decides what
// that means. Advisory terms appear in reports but never change the code.
import fs from 'node:fs';
import { parseCheckArgs, checkTargets } from '../lib/check.js';

const { targets, format, error } = parseCheckArgs(process.argv.slice(2));
if (error) {
  console.error(`just-say-so: ${error}`);
  console.error('usage: check.js [--format text|json] <file...> ("-" reads stdin)');
  process.exit(2);
}

const stdinText = targets.includes('-') ? fs.readFileSync(0, 'utf8') : '';
const { results, exitCode } = checkTargets(targets, { cwd: process.cwd(), stdinText });

if (format === 'json') {
  console.log(JSON.stringify({ files: results.map(({ report, ...rest }) => rest) }, null, 2));
} else {
  for (const r of results) {
    if (r.status === 'error') console.error(`just-say-so: ${r.path}: ${r.message}`);
    else if (r.report) console.log(`${r.path}\n${r.report}`);
  }
}
process.exit(exitCode);
