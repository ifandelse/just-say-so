// Stop logic, two jobs, both Vale-backed. The reply check lints the final
// assistant message (reply.mode). The session gate runs when files.mode is
// "block": it re-lints the files this session
// wrote whose edit-time errors are still outstanding, and blocks the turn
// while any remain. The gate holds the model to its own additions only —
// the outstanding set was recorded per edit, so the user's WIP and a legacy
// file's old errors never enter it. A rewrite that leaves the alert set
// unchanged stands the gate down instead of burning the harness's block
// budget, and waives those alerts for the rest of the session: the
// stop_hook_active flag that drives the stand-down is per turn, so without
// the waiver every later turn would block once more on the same lines. Reply "warn" records per-rule counts in session state and returns
// nothing: the next rules injection reports them, so the engineer never
// sees a rewrite of a reply they already read. A third job runs regardless
// of either mode: when a /just-say-so:restate prompt opened a rejection
// record, the reply that ends the turn is the rewrite, and it goes into
// that record. A blocked reply is not the rewrite, so the record stays
// open through block cycles and closes on the reply the gate lets stand,
// stand-down included. A fourth job: every Stop appends a reply event to
// the events log with the alerts at all levels, so the log lints a reply
// even when both checks are off (events.mode "on").
// Returns the hook output object, or null for silence.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, findProjectConfig } from '../config.js';
import { loadMessages } from '../rules.js';
import { lastAssistantText, lastExchange } from '../transcript.js';
import { logEvent, eventsOn, summarizeAlerts } from '../events.js';
import { readSession, writeSession } from '../state.js';
import { recordReplyAlerts } from '../reply-alerts.js';
import { rejectionsFile, lintReply, completeRecord } from '../rejections.js';
import {
  alertKey,
  resolveValeConfig,
  lintText,
  lintPath,
  formatAlerts,
  REPLY_NAME
} from '../vale.js';

// The transcript file lags the turn, so the harness's own copy of the
// final message comes first.
function replyText(input) {
  return typeof input.last_assistant_message === 'string' && input.last_assistant_message.length > 0
    ? input.last_assistant_message
    : lastAssistantText(input.transcript_path);
}

// Every level. null when vale is missing or broken:
// the check treats that as clean (session-start told the user), the log
// records that the reply went unlinted.
function lintReplyAllLevels(input, config, configPath, env) {
  const text = replyText(input);
  if (!text) return [];

  const raw = lintText(text, { name: REPLY_NAME, configPath, env });
  if (raw === null) return null;

  return raw.map((a) => ({
    ...a,
    file: 'reply' // stable key — the temp path changes per run
  }));
}

// Drop one error per waived instance, by key. The instance on the waived
// line goes first; when the line moved, the first instance of that key
// goes. What is left is the pool a new edit can have added to.
function subtractWaived(errors, waivedList) {
  const pool = [...errors];
  for (const w of waivedList) {
    let i = pool.findIndex((a) => alertKey(a) === w.key && a.Line === w.line);
    if (i === -1) i = pool.findIndex((a) => alertKey(a) === w.key);
    if (i !== -1) pool.splice(i, 1);
  }
  return pool;
}

// Re-lint each file with outstanding errors and keep the alerts that match
// a recorded one (same rule, same text, counted). Line numbers shift as the
// model edits, so identity is rule + match, capped at the recorded count —
// a pre-existing twin elsewhere in the file cannot sneak into the gate.
// Waived instances leave the pool before the cap applies, so a second
// instance of a waived alert still blocks.
function checkGate(state, config, env) {
  const remainingAlerts = [];
  let changed = false;
  const files = { ...(state.valeFiles ?? {}) };
  const waived = { ...(state.waived ?? {}) };

  for (const [file, rec] of Object.entries(files)) {
    const outstanding = rec?.outstanding ?? [];
    if (outstanding.length === 0 || !fs.existsSync(file)) {
      // Nothing recorded, or the file is gone: either way nothing to gate.
      delete files[file];
      delete waived[file];
      changed = true;
      continue;
    }
    const raw = lintPath(file, { configPath: resolveValeConfig(path.dirname(file), config), env });
    if (raw === null) continue; // vale broke mid-session: never block on stale records

    const errors = subtractWaived(
      raw.filter((a) => a.Severity === 'error'),
      waived[file] ?? []
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
  return { remainingAlerts, files, waived, changed };
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
  const replyMode = config.reply.mode;
  const replyOn = replyMode === 'warn' || replyMode === 'block';
  const gateOn = config.files.mode === 'block';

  const state = readSession(sessionId, env);
  const configPath = resolveValeConfig(configAnchor, config);
  let stateChanged = false;
  const logOn = eventsOn(config);

  if (logOn && !state.model) {
    const model = lastExchange(input.transcript_path).model;
    if (model) {
      state.model = model;
      stateChanged = true;
    }
  }

  // The lint runs for the check, for the log, or both; one Vale run serves
  // both. null means vale is missing or broken.
  const allAlerts = replyOn || logOn ? lintReplyAllLevels(input, config, configPath, env) : null;

  // One reply event per Stop, whatever ends it. The final event for a
  // promptIndex is the turn's outcome; the ones before it are block cycles.
  const logReply = (outcome, rewriteOf = null) => {
    logEvent(
      'reply',
      {
        session: sessionId,
        project: configAnchor ?? null,
        promptIndex: state.promptCount ?? 0,
        sinceReminder: Math.max(0, (state.promptCount ?? 0) - (state.promptAtLastReminder ?? 0)),
        outcome,
        model: state.model ?? null,
        alerts: summarizeAlerts(allAlerts),
        ...(rewriteOf ? { rewriteOf } : {})
      },
      { config, env }
    );
  };

  // Called on every path that lets the turn end, never on a block. Returns
  // the id of the record it closed, or null.
  const finishRewrite = () => {
    if (!state.pendingRewrite) return null;
    const id = state.pendingRewrite;
    const text = replyText(input);
    completeRecord(rejectionsFile(env), id, {
      text,
      alerts: lintReply(text, config, configPath, env)
    });
    state.pendingRewrite = null;
    stateChanged = true;
    return id;
  };

  if (!replyOn && !gateOn) {
    logReply('pass', finishRewrite());
    if (stateChanged) writeSession(sessionId, state, env);
    return null;
  }

  const messages = loadMessages(config);

  const replyErrors = replyOn ? (allAlerts ?? []).filter((a) => a.Severity === 'error') : [];
  if (replyMode === 'warn' && replyErrors.length > 0) {
    state.replyAlerts = recordReplyAlerts(state.replyAlerts, replyErrors);
    stateChanged = true;
  }

  let gateRemaining = [];
  if (gateOn) {
    const gate = checkGate(state, config, env);
    gateRemaining = gate.remainingAlerts;
    state.valeFiles = gate.files;
    state.waived = gate.waived;
    stateChanged = stateChanged || gate.changed;
  }

  const blockAlerts = [...(replyMode === 'block' ? replyErrors : []), ...gateRemaining];

  if (blockAlerts.length > 0) {
    const keys = JSON.stringify(blockAlerts.map((a) => `${a.file}|${alertKey(a)}`).sort());
    if (input.stop_hook_active && state.lastStopBlock === keys) {
      // Same alerts after a rewrite: the model is stuck, and six more block
      // cycles will not unstick it. File alerts are waived for the session;
      // a reply is new text every turn, so reply alerts are not.
      if (gateRemaining.length > 0) {
        const waived = { ...(state.waived ?? {}) };
        for (const a of gateRemaining) {
          waived[a.file] = [...(waived[a.file] ?? []), { key: alertKey(a), line: a.Line }];
        }
        state.waived = waived;
        stateChanged = true;
      }
      logReply('standdown', finishRewrite());
      if (stateChanged) writeSession(sessionId, state, env);
      return { systemMessage: gateRemaining.length > 0 ? messages.stopGateStandDown : messages.outputStandDown };
    }
    state.lastStopBlock = keys;
    logReply('block');
    writeSession(sessionId, state, env);

    const parts = [];
    if (replyMode === 'block' && replyErrors.length > 0) {
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

  logReply('pass', finishRewrite());
  if (stateChanged) writeSession(sessionId, state, env);
  return null;
}
