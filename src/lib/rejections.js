// Records for /just-say-so:restate. When the user rejects a reply, the
// prompt hook saves that reply verbatim with the user's reason, and the Stop
// hook adds the rewrite. The model never quotes or saves anything itself;
// both texts come from the harness. The records tune the user's own setup:
// a rejected reply that Vale passed points at a missing rule or a level set
// too low, a rejected reply with a tag no bullet covers points at a judgment
// rule still to be written, and rejections per turn is a drift rate for one
// user's sessions.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';
import { lintText, REPLY_NAME } from './vale.js';
import { configSnapshot } from './config.js';
import { pluginVersion } from './version.js';

const COMMAND = /^\/just-say-so:restate(?:\s+([\s\S]*))?$/;

// The tags in a reason: every #word, lowercased, with anything outside
// [a-z0-9-] turned into a hyphen. The reason keeps the words as typed;
// the tags are an index over it, so nothing is carved out of the record
// to make them.
export function tagsIn(reason) {
  const out = [];
  for (const m of String(reason ?? '').matchAll(/(?:^|\s)#([^\s#]+)/g)) {
    const tag = m[1]
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// The prompt hook receives a typed skill command as typed, not expanded.
// Returns { reason, tags } for the restate command, with reason null when
// the user gave none; null for any other prompt.
export function parseRestate(prompt) {
  const m = COMMAND.exec(String(prompt ?? '').trim());
  if (!m) return null;
  const reason = (m[1] ?? '').trim();
  return { reason: reason.length > 0 ? reason : null, tags: tagsIn(reason) };
}

export function rejectionsFile(env = process.env) {
  return path.join(stateDir(env), 'rejections.jsonl');
}

// Every Vale level, not just errors: the record exists to show what the
// styles missed or set too low, so a warning that fired is as telling as an
// error that did not. null when vale is missing or broken.
export function lintReply(text, config, configPath, env = process.env) {
  if (!text) return [];
  const raw = lintText(text, { name: REPLY_NAME, configPath, env });
  if (raw === null) return null;
  return raw.map((a) => ({
    check: a.Check,
    severity: a.Severity,
    line: a.Line,
    match: a.Match,
    message: a.Message
  }));
}

// prompt is the user prompt that produced the rejected reply, so the record
// can stand as an eval case; model and sinceReminder (prompts between the
// last rules injection and that reply) are the two joins a summary needs
// without the events log.
export function newRecord({
  sessionId,
  project,
  promptIndex,
  reason,
  rejected,
  config,
  prompt = null,
  model = null,
  sinceReminder = null,
  now = new Date()
}) {
  const suffix = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return {
    id: `${now.toISOString()}-${suffix}`,
    session: sessionId,
    project: project ?? null,
    promptIndex,
    sinceReminder,
    model,
    reason,
    tags: tagsIn(reason),
    prompt,
    rejected,
    rewrite: null,
    version: pluginVersion(),
    config: configSnapshot(config)
  };
}

export function appendRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

export function readRecords(file) {
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
      // a damaged line stays out of the parsed set but is kept on disk by completeRecord
    }
  }
  return out;
}

// Fill the rewrite into the record with this id. The file is small and
// local, so a read-modify-write is fine; lines that do not parse are kept
// as they are. Returns true when a record was updated.
export function completeRecord(file, id, rewrite) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  let found = false;
  const lines = raw.split('\n').map((line) => {
    if (found || !line.trim()) return line;
    try {
      const rec = JSON.parse(line);
      if (rec?.id !== id) return line;
      found = true;
      return JSON.stringify({ ...rec, rewrite });
    } catch {
      return line;
    }
  });
  if (found) fs.writeFileSync(file, lines.join('\n'));
  return found;
}
