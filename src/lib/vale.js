// Vale runner: config discovery, subprocess invocation, alert shaping, and
// the config-level exemptions (disableWords / allowPhrases) that keep the
// plugin's escape hatches working whether or not a repo has a vocabulary.
// Every failure path returns null — a broken or missing binary makes the
// checks silent, never broken; session-start owns telling the user once.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { termRegex } from './matcher.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_NAMES = ['.vale.ini', '_vale.ini', 'vale.ini'];
const SPAWN_TIMEOUT_MS = 10_000;

export function shippedConfigPath() {
  return path.join(PKG_ROOT, 'vale', 'fallback.ini');
}

function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

// Nearest Vale config walking up from startDir, the same walk Vale itself
// does. Returns the config path or null.
export function findValeConfig(startDir) {
  let dir = startDir ? path.resolve(startDir) : null;
  while (dir) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Explicit vale.config beats discovery; discovery beats the shipped fallback.
export function resolveValeConfig(anchorDir, config) {
  const override = config?.vale?.config;
  if (override) return expandHome(override);
  return findValeConfig(anchorDir) ?? shippedConfigPath();
}

// `ls-dirs` exists in errata-ai vale and not in the other linter that ships
// under the same binary name, so one probe answers both "installed?" and
// "the right vale?".
export function probeVale(env = process.env) {
  const r = spawnSync('vale', ['ls-dirs'], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env });
  return !r.error && r.status === 0;
}

function parseAlerts(stdout, cwd) {
  let parsed;
  try {
    parsed = JSON.parse(stdout || '{}');
  } catch {
    return null;
  }
  const alerts = [];
  for (const [file, list] of Object.entries(parsed)) {
    if (!Array.isArray(list)) continue;
    for (const a of list) alerts.push({ ...a, file: path.resolve(cwd, file) });
  }
  return alerts;
}

/**
 * Lint one file with Vale. The file is passed relative to the config's
 * directory when it sits under it, so `[glob]` sections in the config match
 * the paths their authors wrote. Returns an alert array or null on failure.
 */
export function lintPath(filePath, { configPath, env = process.env } = {}) {
  const abs = path.resolve(filePath);
  const configDir = path.dirname(path.resolve(configPath));
  const under = !path.relative(configDir, abs).startsWith('..');
  const cwd = under ? configDir : path.dirname(abs);
  const target = under ? path.relative(configDir, abs) : path.basename(abs);

  const r = spawnSync('vale', ['--output=JSON', `--config=${configPath}`, target], {
    cwd,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env
  });
  // Exit 0 = clean, 1 = alerts found; both carry JSON. 2 = vale itself
  // failed (bad config, wrong binary) — silence, not a crash.
  if (r.error || r.status === 2 || typeof r.status !== 'number') return null;
  return parseAlerts(r.stdout, cwd);
}

/**
 * Lint a text fragment under a chosen filename (the name is the contract:
 * `*.chat.md` selects the reduced chat section of the config). Returns an
 * alert array or null on failure.
 */
export function lintText(text, { name = 'reply.chat.md', configPath, env = process.env } = {}) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'just-say-so-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, String(text ?? ''));
    return lintPath(file, { configPath, env });
  } catch {
    return null;
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SEVERITY_RANK = { error: 0, warning: 1, suggestion: 2 };

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 3;
}

export function countBySeverity(alerts) {
  const counts = { error: 0, warning: 0, suggestion: 0 };
  for (const a of alerts) {
    if (a.Severity in counts) counts[a.Severity]++;
  }
  return counts;
}

// Terms compare the way the matcher matches: case-insensitive, hyphen and
// space interchangeable.
function foldTerm(s) {
  return String(s).toLowerCase().replace(/[\s -]+/g, ' ').trim();
}

/**
 * Apply the config escape hatches to Vale alerts. disableWords drops every
 * alert whose matched text is the disabled term; allowPhrases drops alerts
 * whose span sits inside an allowed phrase on the same line. lineTextFor
 * supplies line content (file, line) => string|null; alerts whose line
 * cannot be read stay.
 */
export function applyConfigExemptions(alerts, bannedCheck, lineTextFor) {
  const disabled = new Set((bannedCheck?.disableWords ?? []).map(foldTerm));
  const allow = bannedCheck?.allowPhrases ?? [];

  return alerts.filter((a) => {
    if (disabled.has(foldTerm(a.Match))) return false;
    if (allow.length === 0) return true;
    const line = lineTextFor(a.file, a.Line);
    if (typeof line !== 'string') return true;
    const [start, end] = a.Span ?? [];
    if (!start || !end) return true;
    for (const phrase of allow) {
      for (const m of line.matchAll(termRegex(phrase))) {
        const s = m.index + 1; // Vale spans are 1-based columns
        const e = m.index + m[0].length;
        if (start >= s && end <= e) return false;
      }
    }
    return true;
  });
}

// Reads file lines lazily and caches per file; the shape lintPath alerts
// expect for applyConfigExemptions.
export function fileLineReader() {
  const cache = new Map();
  return (file, line) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, fs.readFileSync(file, 'utf8').split('\n'));
      } catch {
        cache.set(file, null);
      }
    }
    const lines = cache.get(file);
    return lines ? (lines[line - 1] ?? null) : null;
  };
}

function truncateMatch(s, max = 48) {
  const t = String(s ?? '').replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * Render alerts for the model: errors first, then warnings, then
 * suggestions, capped at `limit` characters (the harness truncates hook
 * output past 10,000 and tells nobody).
 */
export function formatAlerts(alerts, { limit = 9000, truncatedNote = '(report truncated)', withFile = false } = {}) {
  const sorted = [...alerts].sort(
    (a, b) => severityRank(a.Severity) - severityRank(b.Severity) || a.Line - b.Line
  );
  const lines = [];
  let used = 0;
  for (const a of sorted) {
    const where = withFile ? `${a.file}:L${a.Line}` : `L${a.Line}`;
    const line = `  - ${where} ${a.Severity} ${a.Check}: ${a.Message} ["${truncateMatch(a.Match)}"]`;
    if (used + line.length + 1 > limit) {
      lines.push(`  ${truncatedNote}`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
