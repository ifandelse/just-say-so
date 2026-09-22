import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, findProjectConfig } from './config.js';
import { loadBanned, loadMessages } from './rules.js';
import { findViolations, formatViolations } from './matcher.js';
import { matchesAny } from './glob.js';

const FORMATS = ['text', 'json'];

export function parseCheckArgs(argv) {
  const targets = [];
  let format = 'text';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--format') {
      i += 1;
      if (i >= argv.length) return { error: '--format needs a value' };
      format = argv[i];
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else if (arg !== '-' && arg.startsWith('-')) {
      return { error: `unknown option ${arg}` };
    } else {
      targets.push(arg);
    }
  }
  if (!FORMATS.includes(format)) return { error: `unknown format "${format}"` };
  if (targets.length === 0) return { error: 'no files given' };
  return { targets, format, error: null };
}

/**
 * Check each target ("-" = stdin) against the config resolved from the
 * file's own directory, mirroring the PreToolUse hook. bannedCheck.mode is
 * deliberately ignored: this is the reporting path, and the caller owns the
 * consequences. Exit codes: 0 clean, 1 hard violations, 2 read errors.
 * Advisory (contextual) terms appear in results but never set the exit code.
 */
export function checkTargets(targets, { cwd, env = process.env, stdinText = '' } = {}) {
  const results = targets.map((target) => checkOne(target, cwd, env, stdinText));
  const exitCode = results.some((r) => r.status === 'error')
    ? 2
    : results.some((r) => r.status === 'checked' && r.hard.length > 0)
      ? 1
      : 0;
  return { results, exitCode };
}

function checkOne(target, cwd, env, stdinText) {
  if (target === '-') return scan('-', stdinText, loadConfig(cwd, env));

  const filePath = path.resolve(cwd, target);
  const config = loadConfig(path.dirname(filePath), env);
  const bc = config.bannedCheck;

  // Same glob anchoring as the hook: relative patterns measure from the
  // directory holding the project config, or cwd when there is none.
  const projectFile = findProjectConfig(path.dirname(filePath));
  const globBase = projectFile ? path.dirname(projectFile) : cwd;
  if (matchesAny(filePath, bc.exclude, globBase)) return { path: target, status: 'skipped' };
  if ((bc.include ?? []).length > 0 && !matchesAny(filePath, bc.include, globBase)) {
    return { path: target, status: 'skipped' };
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { path: target, status: 'error', message: err.message };
  }
  return scan(target, text, config);
}

function scan(name, text, config) {
  const { hard, soft } = findViolations(text, loadBanned(config));
  const report =
    hard.length || soft.length
      ? formatViolations(hard, soft, loadMessages(config).advisoryLabel)
      : '';
  return { path: name, status: 'checked', hard, soft, report };
}
