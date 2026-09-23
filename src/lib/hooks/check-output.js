// Stop logic, two jobs, both Vale-backed. The reply check lints the final
// assistant message (off by default; outputCheck.mode). The session gate
// runs when bannedCheck.mode is "block": it re-lints the files this session
// wrote whose edit-time errors are still outstanding, and blocks the turn
// while any remain. The gate holds the model to its own additions only —
// the outstanding set was recorded per edit, so the user's WIP and a legacy
// file's old errors never enter it. A rewrite that leaves the alert set
// unchanged stands the gate down instead of burning the harness's block
// budget. "warn" queues a note the remind hook delivers with the next
// prompt, and also returns the report as stderr for the shim to print — a
// single-prompt run (CI) has no next prompt, so the log line is the only
// visible copy there.
// Returns the hook output object, or null for silence.
import path from 'node:path';
import { loadConfig, findProjectConfig } from '../config.js';
import { loadMessages } from '../rules.js';
import { lastAssistantText } from '../transcript.js';
import { readSession, writeSession } from '../state.js';
import { alertKey } from './check-vale.js';
import {
  resolveValeConfig,
  lintText,
  lintPath,
  applyConfigExemptions,
  fileLineReader,
  formatAlerts
} from '../vale.js';

const MAX_PENDING_NOTES = 3;

function checkReply(input, config, configPath, env) {
  const text =
    typeof input.last_assistant_message === 'string' && input.last_assistant_message.length > 0
      ? input.last_assistant_message
      : lastAssistantText(input.transcript_path);
  if (!text) return [];

  const raw = lintText(text, { name: 'reply.chat.md', configPath, env });
  if (raw === null) return []; // vale missing or broken: silent, session-start told the user

  const lines = text.split('\n');
  return applyConfigExemptions(raw, config.bannedCheck, (_file, line) => lines[line - 1] ?? null)
    .filter((a) => a.Severity === 'error')
    .map((a) => ({ ...a, file: 'reply' })); // stable key — the temp path changes per run
}

// Re-lint each file with outstanding errors and keep the alerts that match
// a recorded one (same rule, same text, counted). Line numbers shift as the
// model edits, so identity is rule + match, capped at the recorded count —
// a pre-existing twin elsewhere in the file cannot sneak into the gate.
function checkGate(state, config, env) {
  const remainingAlerts = [];
  let changed = false;
  const files = { ...(state.valeFiles ?? {}) };

  for (const [file, rec] of Object.entries(files)) {
    const outstanding = rec?.outstanding ?? [];
    if (outstanding.length === 0) {
      delete files[file];
      changed = true;
      continue;
    }
    const raw = lintPath(file, { configPath: resolveValeConfig(path.dirname(file), config), env });
    if (raw === null) continue; // vale broke mid-session: never block on stale records

    const errors = applyConfigExemptions(
      raw.filter((a) => a.Severity === 'error'),
      config.bannedCheck,
      fileLineReader()
    );
    const budget = new Map();
    for (const o of outstanding) budget.set(o.key, (budget.get(o.key) ?? 0) + 1);
    const remaining = [];
    for (const a of errors) {
      const left = budget.get(alertKey(a)) ?? 0;
      if (left > 0) {
        remaining.push(a);
        budget.set(alertKey(a), left - 1);
      }
    }
    if (remaining.length === 0) delete files[file];
    else files[file] = { outstanding: remaining.map((a) => ({ key: alertKey(a), line: a.Line })) };
    changed = true;
    remainingAlerts.push(...remaining);
  }
  return { remainingAlerts, files, changed };
}

export function run(input, env = process.env) {
  const sessionId = input.session_id ?? 'unknown';

  // Stop events can carry a cwd outside the project (seen live). When the
  // event's cwd finds no project config, fall back to the project directory
  // the prompt hook recorded for this session.
  let configAnchor = input.cwd;
  if (!findProjectConfig(input.cwd)) {
    const recorded = readSession(sessionId, env).projectDir;
    if (recorded && findProjectConfig(recorded)) configAnchor = recorded;
  }
  const config = loadConfig(configAnchor, env);
  const outputMode = config.outputCheck.mode;
  const gateOn = config.bannedCheck.mode === 'block';
  if (outputMode === 'off' && !gateOn) return null;

  const state = readSession(sessionId, env);
  const messages = loadMessages(config);
  const configPath = resolveValeConfig(configAnchor, config);
  let stateChanged = false;

  const replyErrors = outputMode === 'off' ? [] : checkReply(input, config, configPath, env);

  let gateRemaining = [];
  if (gateOn) {
    const gate = checkGate(state, config, env);
    gateRemaining = gate.remainingAlerts;
    state.valeFiles = gate.files;
    stateChanged = stateChanged || gate.changed;
  }

  const blockAlerts = [...(outputMode === 'block' ? replyErrors : []), ...gateRemaining];

  if (blockAlerts.length > 0) {
    const keys = JSON.stringify(blockAlerts.map((a) => `${a.file}|${alertKey(a)}`).sort());
    if (input.stop_hook_active && state.lastStopBlock === keys) {
      // Same alerts after a rewrite: the model is stuck, and six more block
      // cycles will not unstick it.
      if (stateChanged) writeSession(sessionId, state, env);
      return { systemMessage: messages.stopGateStandDown };
    }
    state.lastStopBlock = keys;
    writeSession(sessionId, state, env);

    const parts = [];
    if (outputMode === 'block' && replyErrors.length > 0) {
      parts.push(`${messages.outputIntro}\n${formatAlerts(replyErrors, { truncatedNote: messages.valeTruncated })}`);
    }
    if (gateRemaining.length > 0) {
      parts.push(
        `${messages.stopGateIntro}\n${formatAlerts(gateRemaining, { truncatedNote: messages.valeTruncated, withFile: true })}`
      );
    }
    parts.push(gateRemaining.length > 0 ? messages.valeFixInstruction : messages.outputRewrite);
    return { decision: 'block', reason: parts.join('\n') };
  }

  if (state.lastStopBlock) {
    state.lastStopBlock = null;
    stateChanged = true;
  }

  if (outputMode === 'warn' && replyErrors.length > 0) {
    const message = `${messages.outputIntro}\n${formatAlerts(replyErrors, { truncatedNote: messages.valeTruncated })}\n${messages.outputRewrite}`;
    state.pendingNotes = [...(state.pendingNotes ?? []), message].slice(-MAX_PENDING_NOTES);
    writeSession(sessionId, state, env);
    return { stderr: message };
  }

  if (stateChanged) writeSession(sessionId, state, env);
  return null;
}
