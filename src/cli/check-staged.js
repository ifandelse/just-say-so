#!/usr/bin/env node
// Vale on the lines a commit adds, errors only. Run with no arguments as a
// pre-commit hook (lints the staged index content), or with --base <ref> in
// CI to check everything a branch added since its merge-base. Exit 0 clean
// or advisory only, 1 error-level alerts on added lines, 2 usage or
// environment errors. Skip once with: JUST_SAY_SO_PRECOMMIT=0 git commit ...
import { runStagedCheck } from '../lib/check-staged.js';

const args = process.argv.slice(2);
let base = null;
if (args[0] === '--base' && args[1]) {
  base = args[1];
} else if (args.length > 0) {
  console.error('usage: check-staged.js [--base <ref>]');
  process.exit(2);
}

const { exitCode, report, notices } = runStagedCheck({ base });
if (report) console.log(report);
for (const line of notices) console.error(line);
process.exit(exitCode);
