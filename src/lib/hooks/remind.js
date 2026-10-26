// UserPromptSubmit logic: inject the condensed rules when a trigger is due,
// with the reply-check report appended when counts are waiting. Two
// triggers: the configured interval (prompts or tokens), and, when the
// reply check delivers on the next prompt, counts recorded since the last
// injection. Any firing resets the interval, so the two never stack.
// A /just-say-so:restate prompt is the third case: the hook records the
// rejected reply from the transcript, emits nothing (the skill body carries
// the rules and the instruction), and resets the interval because the
// rules are going out through the skill. The waiting reply counts go with
// the record: they describe the reply being rejected, and a report about
// it on the next prompt would describe the wrong reply.
// Returns the hook output object, or null for silence.
import { loadConfig, DEFAULTS } from '../config.js';
import { readRules, loadMessages } from '../rules.js';
import { readSession, writeSession } from '../state.js';
import { contextSize, lastExchange } from '../transcript.js';
import { logEvent } from '../events.js';
import { formatReplyReport, replyCheckMode, deliversNextPrompt } from '../reply-alerts.js';
import { parseRestate, rejectionsFile, lintReply, newRecord, appendRecord } from '../rejections.js';
import { resolveValeConfig } from '../vale.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const sessionId = input.session_id ?? 'unknown';
  const state = readSession(sessionId, env);
  state.promptCount = (state.promptCount ?? 0) + 1;
  // Prompt events carry a trustworthy cwd; record it so hooks whose events
  // don't (Stop, seen live) can still find the project config.
  if (input.cwd) state.projectDir = input.cwd;

  const restate = parseRestate(input.prompt);
  if (restate) {
    const { prompt, text, model } = lastExchange(input.transcript_path);
    const configPath = resolveValeConfig(input.cwd, config);
    // The rejected reply answered the previous prompt, so its distance from
    // the last injection is measured from there.
    const sinceReminder = Math.max(0, state.promptCount - 1 - (state.promptAtLastReminder ?? 0));
    const record = newRecord({
      sessionId,
      project: input.cwd ?? null,
      promptIndex: state.promptCount,
      reason: restate.reason,
      rejected: { text, alerts: lintReply(text, config, configPath, env) },
      config,
      prompt,
      model,
      sinceReminder
    });
    appendRecord(rejectionsFile(env), record);
    const common = { session: sessionId, project: input.cwd ?? null, promptIndex: state.promptCount };
    logEvent(
      'restate',
      { ...common, sinceReminder, record: record.id, reasonGiven: restate.reason !== null },
      { config, env }
    );
    logEvent('reminder', { ...common, trigger: 'restate', withReport: false }, { config, env });
    state.pendingRewrite = record.id;
    state.replyAlerts = {};
    state.promptAtLastReminder = state.promptCount;
    state.contextAtLastReminder = null;
    if (!state.model && model) state.model = model;
    writeSession(sessionId, state, env);
    return null;
  }

  const mode = config.reminder.mode;
  const countsWaiting = Object.keys(state.replyAlerts ?? {}).length > 0;
  const reportFire = countsWaiting && replyCheckMode(config) === 'warn' && deliversNextPrompt(config);
  let intervalFire = false;
  let ctx = null;

  if (mode === 'prompts') {
    const n = Math.max(1, Number(config.reminder.everyPrompts) || DEFAULTS.reminder.everyPrompts);
    intervalFire = state.promptCount - (state.promptAtLastReminder ?? 0) >= n;
  } else if (mode === 'tokens') {
    ctx = contextSize(input.transcript_path);
    if (ctx !== null) {
      if (state.contextAtLastReminder == null) {
        // First sight of this session: set the baseline, don't fire on growth.
        state.contextAtLastReminder = ctx;
      } else {
        const threshold = Math.max(1, Number(config.reminder.everyTokens) || 4000);
        intervalFire = ctx - state.contextAtLastReminder >= threshold;
      }
    }
  }

  let output = null;
  if (reportFire || intervalFire) {
    const parts = [readRules('condensed', config)];
    // The report rides the rules, never a schedule of its own: the counts
    // wait here until the rules go out.
    const report = formatReplyReport(state.replyAlerts, loadMessages(config));
    if (report) {
      parts.push(report);
      state.replyAlerts = {};
    }
    // The interval names the trigger when both are due; the report rides it.
    const trigger = intervalFire ? (mode === 'tokens' ? 'tokens' : 'interval') : 'report';
    logEvent(
      'reminder',
      { session: sessionId, project: input.cwd ?? null, promptIndex: state.promptCount, trigger, withReport: report !== null },
      { config, env }
    );
    state.promptAtLastReminder = state.promptCount;
    if (mode === 'tokens' && ctx !== null) state.contextAtLastReminder = ctx;
    output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parts.map((p) => p.trim()).join('\n\n')
      }
    };
  }

  writeSession(sessionId, state, env);
  return output;
}
