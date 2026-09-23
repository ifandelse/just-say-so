import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function stateDir(env = process.env) {
  if (env.JUST_SAY_SO_STATE_DIR) return env.JUST_SAY_SO_STATE_DIR;
  if (env.CLAUDE_PLUGIN_DATA) return path.join(env.CLAUDE_PLUGIN_DATA, 'state');
  const base = env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'just-say-so');
}

function sessionFile(sessionId, env) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(stateDir(env), 'sessions', safe + '.json');
}

const FRESH = {
  promptCount: 0,
  contextAtLastReminder: null,
  pendingNotes: [],
  projectDir: null,
  // Per-file record of error-level Vale alerts in lines this session added,
  // keyed by absolute path — the Stop gate checks these, and only these.
  valeFiles: {},
  // Alert keys from the last Stop block: when a rewrite leaves the set
  // unchanged, the gate stands aside instead of burning the block budget.
  lastStopBlock: null
};

export function readSession(sessionId, env = process.env) {
  try {
    return { ...FRESH, ...JSON.parse(fs.readFileSync(sessionFile(sessionId, env), 'utf8')) };
  } catch {
    return { ...FRESH };
  }
}

export function writeSession(sessionId, data, env = process.env) {
  const file = sessionFile(sessionId, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

export function resetSession(sessionId, env = process.env) {
  writeSession(sessionId, { ...FRESH }, env);
}

// Session files are small; drop anything a week old.
export function cleanupSessions(env = process.env, maxAgeMs = WEEK_MS) {
  const dir = path.join(stateDir(env), 'sessions');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      // another process racing us is fine
    }
  }
}
