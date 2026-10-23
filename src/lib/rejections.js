// Records for /just-say-so:restate. When the user rejects a reply, the
// prompt hook saves that reply verbatim with the user's reason, and the Stop
// hook adds the rewrite. The model never quotes or saves anything itself;
// both texts come from the harness. The records tune the user's own setup:
// a rejected reply that Vale passed points at a missing rule or a level set
// too low, and rejections per prompt is a drift rate for one user's sessions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from './state.js';
import { lintText, applyConfigExemptions } from './vale.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMAND = /^\/just-say-so:restate(?:\s+([\s\S]*))?$/;

// The prompt hook receives a typed skill command as typed, not expanded.
// Returns { reason } for the restate command, with reason null when the
// user gave none; null for any other prompt.
export function parseRestate(prompt) {
  const m = COMMAND.exec(String(prompt ?? '').trim());
  if (!m) return null;
  const reason = (m[1] ?? '').trim();
  return { reason: reason.length > 0 ? reason : null };
}

export function rejectionsFile(env = process.env) {
  return path.join(stateDir(env), 'rejections.jsonl');
}

// Every Vale level, not just errors: the record exists to show what the
// styles missed or set too low, so a warning that fired is as telling as an
// error that did not. null when vale is missing or broken.
export function lintReply(text, config, configPath, env = process.env) {
  if (!text) return [];
  const raw = lintText(text, { name: 'reply.chat.md', configPath, env });
  if (raw === null) return null;
  const lines = String(text).split('\n');
  return applyConfigExemptions(raw, config.bannedCheck, (_file, line) => lines[line - 1] ?? null).map((a) => ({
    check: a.Check,
    severity: a.Severity,
    line: a.Line,
    match: a.Match,
    message: a.Message
  }));
}

function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export function newRecord({ sessionId, project, promptIndex, reason, rejected, config, now = new Date() }) {
  const suffix = Math.random().toString(16).slice(2, 6).padEnd(4, '0');
  return {
    id: `${now.toISOString()}-${suffix}`,
    session: sessionId,
    project: project ?? null,
    promptIndex,
    reason,
    rejected,
    rewrite: null,
    version: pluginVersion(),
    reminder: { mode: config.reminder?.mode ?? null, everyPrompts: config.reminder?.everyPrompts ?? null },
    outputCheck: { mode: config.outputCheck?.mode ?? null, deliver: config.outputCheck?.deliver ?? null }
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
