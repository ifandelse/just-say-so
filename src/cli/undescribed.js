#!/usr/bin/env node
// List the enabled Vale rules that the reminder can only name, with the
// facts a writer needs to draft a bullet for each. --all includes warning
// and suggestion rules; --json prints the raw records.
import { undescribedRules, formatUndescribed } from '../lib/undescribed.js';

const args = process.argv.slice(2);
const minLevel = args.includes('--all') ? 'suggestion' : 'error';
const rules = undescribedRules(process.cwd(), process.env, { minLevel });
if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(rules, null, 2) + '\n');
} else {
  process.stdout.write(formatUndescribed(rules, { minLevel }));
}
process.exit(rules === null ? 1 : 0);
