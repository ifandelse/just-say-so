// The events log: one JSON line per countable thing a hook saw, appended to
// events.jsonl in the state directory and never pruned. It holds rule names
// and integers, no prose; the prose stays in rejections.jsonl. Rejections
// alone cannot give a rate, so this file carries the denominators: prompts,
// rules injections, replies checked and what they fired, terms allowed.
// Every line has t, e, session, project, v; the rest depends on e.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';
import { pluginVersion } from './version.js';
import { isShortMatch, dedupeOverlaps } from './reply-alerts.js';

export function eventsFile(env = process.env) {
  return path.join(stateDir(env), 'events.jsonl');
}

export function eventsOn(config) {
  return (config?.events?.mode ?? 'on') !== 'off';
}

// Append one event. Returns false when the log is off. The write is one
// appendFileSync of a line well under a kilobyte, which stays whole under
// concurrent sessions on a local filesystem.
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
  const file = eventsFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + '\n');
  return true;
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

// Vale alerts folded to counts per rule and severity. A short fixed match
// (a banned word, a filler phrase) keeps its own entry so an allow can be
// joined to the rule it silences; a longer match is a span of the reply and
// is left out. Two styles that flag one span count once. null passes
// through: it means the reply was not linted.
export function summarizeAlerts(alerts) {
  if (alerts === null || alerts === undefined) return null;
  const groups = new Map();
  for (const a of dedupeOverlaps(alerts)) {
    const match = isShortMatch(a.Match) ? String(a.Match).trim().toLowerCase() : null;
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
