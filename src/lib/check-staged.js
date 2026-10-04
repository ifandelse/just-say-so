// The commit-time gate: Vale on the lines a commit (or branch) adds, errors
// only. Staged mode lints the index content — a partially staged file is
// judged on what will land — and --base mode lints the working tree against
// a merge-base, which gives CI the same check over a branch.
//
// Alerts are kept when they sit on an added line, plus whole-file rules
// regardless of line: those judge the entire document and report at line 1
// or the first match, so a line filter would drop them on any edit that
// misses that line. The gate must not depend on the Claude Code plugin
// being installed — committers without it meet the same policy here.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';
import {
  applyConfigExemptions,
  countBySeverity,
  probeVale,
  resolveValeConfig,
  severityRank
} from './vale.js';

export const MARKDOWN_EXT = ['.md', '.mdx', '.markdown'];
const SPAWN_TIMEOUT_MS = 30_000;

const DIFF_HEADER = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });
}

// A failed git call must not pass as an empty result: with no added lines
// every alert would be dropped and the gate would go green having checked
// nothing. Callers turn the throw into exit 2.
function gitOrThrow(args, cwd) {
  const r = git(args, cwd);
  if (r.error || r.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout;
}

function isMarkdown(file) {
  return MARKDOWN_EXT.includes(path.extname(file).toLowerCase());
}

// The diff pathspec goes by extension, not by file list. Limiting it to the
// linted files would hide a rename's source path from git, which then
// reports the destination as a new file with every line added. Extra paths
// in the map are inert: selectAlerts looks up only the linted files.
function extensionPathspec(files) {
  const exts = [...new Set(files.map((f) => path.extname(f)).filter(Boolean))].sort();
  return exts.length > 0 ? exts.map((e) => `*${e}`) : [...files];
}

/** Map each path in a -U0 diff to the set of line numbers it added. */
export function parseAddedLines(diffText) {
  const added = new Map();
  let current = null;
  for (const line of diffText.split('\n')) {
    const header = DIFF_HEADER.exec(line);
    if (header) {
      current = header[2];
      if (!added.has(current)) added.set(current, new Set());
      continue;
    }
    const hunk = HUNK_HEADER.exec(line);
    if (hunk && current !== null) {
      const start = parseInt(hunk[1], 10);
      const count = hunk[2] === undefined ? 1 : parseInt(hunk[2], 10);
      const lines = added.get(current);
      for (let n = start; n < start + count; n++) lines.add(n);
    }
  }
  return added;
}

// A rule is whole-file when its YAML says `extends: metric`, or
// `extends: occurrence` with a document-wide scope (summary, raw, or a
// doc(...) selector). Occurrence rules scoped to a sentence or paragraph
// report at that unit's own line and stay line-anchored.
export function isWholeFileRule(yamlText) {
  const kind = /^extends:\s*(\w+)/m.exec(yamlText);
  if (!kind) return false;
  if (kind[1] === 'metric') return true;
  if (kind[1] !== 'occurrence') return false;
  const scope = /^scope:\s*['"]?([^'"\n]*)/m.exec(yamlText);
  const value = (scope?.[1] ?? '').trim();
  return value === 'summary' || value === 'raw' || value.startsWith('doc(');
}

/** "Style.Rule" names under stylesDir whose YAML describes a whole-file check. */
export function fileLevelRules(stylesDir) {
  const rules = new Set();
  if (!stylesDir || !fs.existsSync(stylesDir)) return rules;
  for (const style of fs.readdirSync(stylesDir)) {
    const styleDir = path.join(stylesDir, style);
    if (style === 'config' || !fs.statSync(styleDir).isDirectory()) continue;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.yml')) {
          // Vale names a nested rule file styles/Style/sub/Rule.yml as Style.sub.Rule.
          const rel = path.relative(styleDir, full).slice(0, -4);
          if (isWholeFileRule(fs.readFileSync(full, 'utf8'))) {
            rules.add(`${style}.${rel.split(path.sep).join('.')}`);
          }
        }
      }
    };
    walk(styleDir);
  }
  return rules;
}

/** StylesPath from a Vale config, resolved relative to the config file. */
export function stylesDirFor(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  const m = /^StylesPath\s*=\s*(.+)$/m.exec(text);
  if (!m) return null;
  return path.resolve(path.dirname(configPath), m[1].trim());
}

/**
 * Keep alerts on added lines plus whole-file rules; `added=null` keeps
 * everything. Returns the kept alerts and the paths Vale reported that the
 * diff never mentioned — a path in one map and not the other means the
 * paths given to Vale and to git disagree, and silently dropping that
 * file's alerts would hide the mistake.
 */
export function selectAlerts(alertsByFile, added, fileLevel) {
  const kept = new Map();
  const unmapped = [];
  for (const [file, alerts] of alertsByFile) {
    let rows;
    if (added === null) {
      rows = alerts;
    } else {
      if (!added.has(file)) unmapped.push(file);
      const allowed = added.get(file) ?? new Set();
      rows = alerts.filter((a) => allowed.has(a.Line) || fileLevel.has(a.Check));
    }
    if (rows.length > 0) kept.set(file, rows);
  }
  return { kept, unmapped };
}

// One vale invocation per file, from `rootDir` with repo-relative paths, so
// `[glob]` sections in the config match the paths their authors wrote.
// Vale resolves StylesPath relative to the config file, not the cwd, which
// is what lets a materialized index tree lint under the repo's real styles.
function lintFiles(files, rootDir, configPath, env) {
  const alertsByFile = new Map();
  for (const file of files) {
    const r = spawnSync('vale', ['--no-exit', '--output=JSON', `--config=${configPath}`, file], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      env
    });
    // Exit 0 = clean, 1 = alerts found (a vale without --no-exit, and the
    // test stand-in); both carry JSON. 2 = vale itself failed, which a gate
    // must report, not swallow.
    if (r.error || r.status === 2 || typeof r.status !== 'number') {
      throw new Error(`vale failed on ${file}: ${(r.stderr || r.error?.message || '').trim()}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(r.stdout || '{}');
    } catch {
      throw new Error(`vale produced unparseable output on ${file}`);
    }
    for (const [key, list] of Object.entries(parsed)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      const prev = alertsByFile.get(key) ?? [];
      alertsByFile.set(key, prev.concat(list.map((a) => ({ ...a, file: key }))));
    }
  }
  return alertsByFile;
}

/** Per-file report lines plus a totals object, for the CLI to print. */
export function renderReport(kept, scope, fileCount) {
  const totals = { error: 0, warning: 0, suggestion: 0 };
  const lines = [`Scope: ${scope}. Files linted: ${fileCount}.`];
  for (const file of [...kept.keys()].sort()) {
    lines.push('', file);
    const rows = [...kept.get(file)].sort(
      (a, b) => severityRank(a.Severity) - severityRank(b.Severity) || a.Line - b.Line
    );
    for (const a of rows) {
      lines.push(`  L${a.Line}:${a.Span?.[0] ?? 0} ${a.Severity.padEnd(10)} ${a.Check.padEnd(38)} ${a.Message}`);
    }
    const c = countBySeverity(kept.get(file));
    totals.error += c.error;
    totals.warning += c.warning;
    totals.suggestion += c.suggestion;
  }
  lines.push(
    '',
    `Totals: ${totals.error} error(s), ${totals.warning} warning(s), ` +
      `${totals.suggestion} suggestion(s) across ${kept.size} file(s).`
  );
  return { lines, totals };
}

/**
 * Run the gate. Returns { exitCode, report, notices }: report goes to
 * stdout, notices to stderr. Exit 0 clean or advisory only, 1 an
 * error-level alert remains on an added line, 2 the environment failed in
 * a way that means the filter could not be trusted.
 */
export function runStagedCheck({ base = null, cwd = process.cwd(), env = process.env } = {}) {
  if (env.JUST_SAY_SO_PRECOMMIT === '0') {
    return { exitCode: 0, report: '', notices: ['just-say-so: check skipped (JUST_SAY_SO_PRECOMMIT=0)'] };
  }

  let root;
  try {
    root = gitOrThrow(['rev-parse', '--show-toplevel'], cwd).trim();
  } catch (e) {
    return { exitCode: 2, report: '', notices: [`just-say-so: ${e.message}`] };
  }

  // Missing vale skips the gate with one notice — the same posture as the
  // in-session hooks, and CI installs vale explicitly so it never skips
  // there. A present-but-broken vale fails loudly below instead.
  if (!probeVale(env)) {
    return { exitCode: 0, report: '', notices: ['just-say-so: vale not found on PATH; staged check skipped'] };
  }

  const config = loadConfig(root, env);
  const configPath = path.resolve(root, resolveValeConfig(root, config));
  const fileLevel = fileLevelRules(stylesDirFor(configPath));

  let tmp = null;
  try {
    let files, diffText, lintRoot, scope;
    if (base) {
      const mergeBase = gitOrThrow(['merge-base', base, 'HEAD'], root).trim();
      const pathspec = ['--', ...MARKDOWN_EXT.map((e) => `*${e}`)];
      files = gitOrThrow(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, 'HEAD', ...pathspec], root)
        .split('\n')
        .filter(Boolean);
      if (files.length === 0) return { exitCode: 0, report: '', notices: [] };
      diffText = gitOrThrow(['diff', '-U0', mergeBase, 'HEAD', '--', ...extensionPathspec(files)], root);
      lintRoot = root;
      scope = `added lines since ${base}`;
    } else {
      files = gitOrThrow(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], root)
        .split('\n')
        .filter(Boolean)
        .filter(isMarkdown);
      if (files.length === 0) return { exitCode: 0, report: '', notices: [] };
      // The index content is what the commit receives, so it is the version
      // to lint, and its line numbers agree with the --cached diff.
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-staged-'));
      gitOrThrow(['checkout-index', `--prefix=${tmp}${path.sep}`, '--', ...files], root);
      diffText = gitOrThrow(['diff', '--cached', '-U0', '--', ...extensionPathspec(files)], root);
      lintRoot = tmp;
      scope = 'staged added lines';
    }

    const raw = lintFiles(files, lintRoot, configPath, env);
    const readLine = lineReaderAt(lintRoot);
    const exempted = new Map();
    for (const [file, alerts] of raw) {
      const left = applyConfigExemptions(alerts, config.bannedCheck, readLine);
      if (left.length > 0) exempted.set(file, left);
    }

    const { kept, unmapped } = selectAlerts(exempted, parseAddedLines(diffText), fileLevel);
    const { lines, totals } = renderReport(kept, scope, files.length);
    const notices = [];
    if (unmapped.length > 0) {
      notices.push(`just-say-so: Vale and git disagree about these paths: ${unmapped.sort().join(', ')}`);
      return { exitCode: 2, report: lines.join('\n'), notices };
    }
    if (totals.error > 0) {
      notices.push(
        'just-say-so: error-level alerts on added lines. Fix them, or skip once with ' +
          'JUST_SAY_SO_PRECOMMIT=0 git commit ...'
      );
      return { exitCode: 1, report: lines.join('\n'), notices };
    }
    const quiet = kept.size === 0;
    return { exitCode: 0, report: quiet ? '' : lines.join('\n'), notices };
  } catch (e) {
    return { exitCode: 2, report: '', notices: [`just-say-so: ${e.message}`] };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Alerts carry repo-relative paths; the exemption filter needs real line
// text, which lives under the lint root (the materialized index in staged
// mode, the working tree in base mode).
function lineReaderAt(rootDir) {
  const cache = new Map();
  return (file, line) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, fs.readFileSync(path.join(rootDir, file), 'utf8').split('\n'));
      } catch {
        cache.set(file, null);
      }
    }
    const lines = cache.get(file);
    return lines ? (lines[line - 1] ?? null) : null;
  };
}
