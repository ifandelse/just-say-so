// Vale runner: config discovery, subprocess invocation, and alert shaping.
// Exemptions are Vale's job (a vocabulary accept.txt), so nothing here
// filters alerts by term. Every failure path returns null — a broken or missing binary makes the
// checks silent, never broken; session-start owns telling the user once.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * What a Vale config says about the reply and publish targets, for the
 * session-start notice. Reads the resolved config through `vale ls-config`
 * so package-supplied sections count. Returns null when vale cannot read it.
 */
export function inspectValeConfig(configPath, env = process.env) {
  const r = spawnSync('vale', ['ls-config', `--config=${configPath}`], {
    cwd: path.dirname(path.resolve(configPath)),
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env
  });
  if (r.error || r.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(r.stdout || '{}');
  } catch {
    return null;
  }
  const formats = parsed.Formats ?? {};
  const sections = [...Object.keys(parsed.SBaseStyles ?? {}), ...Object.keys(parsed.SChecks ?? {})];
  return {
    formatsMapped: formats.reply === 'md' && formats.publish === 'md',
    chatSections: [...new Set(sections.filter((g) => g.includes('chat.md')))]
  };
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
  return foldOverlaps(alerts);
}

/**
 * Two rules that flag overlapping spans on one line (JustSaySo and
 * ai-tells both ban the same verb) report one problem, not two. Keep one
 * alert per overlapping group: the JustSaySo alert when the group has
 * one, because its message is the manifest's, otherwise the first.
 * Every consumer reads folded alerts, so the agent sees one line and
 * the records count one alert.
 */
export function foldOverlaps(alerts) {
  const kept = [];
  for (const a of alerts) {
    const [s, e] = Array.isArray(a.Span) ? a.Span : [null, null];
    const i = kept.findIndex((k) => k.file === a.file && k.Line === a.Line && s !== null && Array.isArray(k.Span) && s <= k.Span[1] && k.Span[0] <= e);
    if (i === -1) kept.push(a);
    else if (!String(kept[i].Check).startsWith('JustSaySo.') && String(a.Check).startsWith('JustSaySo.')) kept[i] = a;
  }
  return kept;
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

// The names text lints under are the contract with the Vale config: a
// section such as [*.reply] or [gh.*.title.publish] selects rules for one
// target, and [*.md] never matches either, so a project's document rules
// stay out of chat. The shipped package maps both extensions to Markdown
// in [formats].
export const REPLY_NAME = 'reply.reply';

// A part may carry its own dots (mcp tool "jira.create_issue"); anything
// else outside [A-Za-z0-9_.-] becomes an underscore.
function fragmentPart(s) {
  return String(s ?? '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '');
}

// The leaf field a gh label names: `--body-file` → body, `-f comments[][body]`
// → body, `--input comments[3].body` → body. Unknown shapes keep their text.
export function fieldFromLabel(label) {
  const last = String(label ?? '').trim().split(/\s+/).pop() ?? '';
  const segments = last.split(/[.[\]]+/).filter(Boolean);
  const leaf = segments.length > 0 ? segments[segments.length - 1] : last;
  return leaf.replace(/^-+/, '').replace(/-file$/, '');
}

/**
 * The name a published fragment lints under: `<source>.<tool>.<field>.publish`,
 * for example `gh.pr.body.publish` or `mcp.jira.create_issue.publish` when
 * the field is unknown. Parts are reduced to [A-Za-z0-9_-] so a name is
 * always a single path segment.
 */
export function publishName({ source, tool, field } = {}) {
  const parts = [source, tool, field].map(fragmentPart).filter(Boolean);
  return `${parts.join('.')}.publish`;
}

/**
 * Lint a text fragment under a chosen filename (the name is the contract:
 * `reply.reply` and `*.publish` select the target sections of the config).
 * Returns an alert array or null on failure.
 */
export function lintText(text, { name = REPLY_NAME, configPath, env = process.env } = {}) {
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

export function alertKey(a) {
  return `${a.Check}|${String(a.Match).toLowerCase()}`;
}

export function truncateMatch(s, max = 48) {
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
