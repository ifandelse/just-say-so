// The events log: one JSON line per countable thing a hook saw, appended to
// events.jsonl in the state directory and never pruned. It holds rule names
// and integers, no prose; the prose stays in rejections.jsonl. Rejections
// alone cannot give a rate, so this file carries the denominators: prompts,
// rules injections, replies checked and what they fired, terms allowed.
// Every line has t, e, session, project, v; the rest depends on e.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';
import { pluginVersion, PKG_ROOT } from './version.js';
import { dedupeOverlaps } from './reply-alerts.js';
import { loadManifest, fixedTerms as manifestTerms } from './manifest.js';

export function eventsFile(env = process.env) {
  return path.join(stateDir(env), 'events.jsonl');
}

export function eventsOn(config) {
  return (config?.events?.mode ?? 'on') !== 'off';
}

// Append one event. Returns false when the log is off or the write fails.
// The log is best effort: the hook runner exits silently on any throw, so
// an append error here would cancel a block decision or a reminder the
// caller has yet to return. The write is one appendFileSync of a line well
// under a kilobyte, which stays whole under concurrent sessions on a local
// filesystem.
export function logEvent(type, fields, { config, env = process.env, now = new Date() }) {
  if (!eventsOn(config)) return false;
  const line = {
    t: now.toISOString(),
    e: type,
    session: fields.session ?? null,
    project: fields.project ?? null,
    v: pluginVersion(),
    ...fields
  };
  try {
    const file = eventsFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + '\n');
    return true;
  } catch {
    return false;
  }
}

export function readEvents(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a damaged line stays out of the parsed set
    }
  }
  return out;
}

// Spelling differences Vale's tokens accept: case, curly apostrophes, and
// any run of spaces, non-breaking spaces, or hyphens between words.
function normalizeTerm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[\s\u00A0-]+/g, ' ')
    .trim();
}

// The shipped banned terms (the manifest's style terms), keyed by
// normalized spelling, read once per process.
let fixedTermsCache = null;
function fixedTerms() {
  if (fixedTermsCache) return fixedTermsCache;
  const map = new Map();
  try {
    for (const term of manifestTerms(loadManifest())) map.set(normalizeTerm(term), term);
  } catch {
    // an unreadable term list keeps every match out of the log
  }
  fixedTermsCache = map;
  return map;
}

// The canonical banned term a match spells, or null. Length and punctuation
// cannot prove a match is a fixed term: a frame rule captures whatever
// filled the frame, and a project style can capture any short text. Only
// a match that equals a shipped term is known to carry no reply prose.
export function fixedTerm(match) {
  return fixedTerms().get(normalizeTerm(match)) ?? null;
}

// Vale alerts folded to counts per rule and severity. A match that equals
// a shipped banned term keeps its own entry, so an allow can be joined to
// the rule it silences; any other match is reply text and is left out.
// Two styles that flag one span count once. null passes through: it means
// the reply was not linted.
export function summarizeAlerts(alerts) {
  if (alerts === null || alerts === undefined) return null;
  const groups = new Map();
  for (const a of dedupeOverlaps(alerts)) {
    const match = fixedTerm(a.Match);
    const key = `${a.Check}|${a.Severity}|${match ?? ''}`;
    const held = groups.get(key);
    if (held) held.n += 1;
    else groups.set(key, { check: a.Check, severity: a.Severity, n: 1, ...(match ? { match } : {}) });
  }
  return [...groups.values()].sort(
    (x, y) =>
      x.check.localeCompare(y.check) || x.severity.localeCompare(y.severity) || (x.match ?? '').localeCompare(y.match ?? '')
  );
}
