// UserPromptSubmit logic: the prompt after a reply broke a rule gets the
// condensed rules with the reply report appended (rules.onViolation with
// reply.mode "warn"). There is no interval: the rules are present from
// context start, and a reminder that carries no new information measured
// as no help. A /just-say-so:restate prompt is the other case: the hook
// records the rejected reply from the transcript, emits nothing (the skill
// body carries the rules and the instruction), and takes the waiting reply
// counts with the record, because they describe the reply being rejected
// and a report about it on the next prompt would describe the wrong reply.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { loadMessages } from '../rules.js';
import { contextRules } from '../rule-state.js';
import { readSession, writeSession } from '../state.js';
import { lastExchange } from '../transcript.js';
import { logEvent } from '../events.js';
import { formatReplyReport } from '../reply-alerts.js';
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

  const common = { session: sessionId, project: input.cwd ?? null, promptIndex: state.promptCount };

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
    logEvent(
      'restate',
      { ...common, sinceReminder, record: record.id, reasonGiven: restate.reason !== null, tags: record.tags },
      { config, env }
    );
    logEvent('reminder', { ...common, trigger: 'restate', withReport: false }, { config, env });
    state.pendingRewrite = record.id;
    state.replyAlerts = {};
    state.promptAtLastReminder = state.promptCount;
    if (!state.model && model) state.model = model;
    writeSession(sessionId, state, env);
    return null;
  }

  const countsWaiting = Object.keys(state.replyAlerts ?? {}).length > 0;
  const fire = countsWaiting && config.reply.mode === 'warn' && config.rules.onViolation === true;

  let output = null;
  if (fire) {
    const parts = [contextRules(config, input.cwd, env)];
    // The report rides the rules, never a schedule of its own.
    const report = formatReplyReport(state.replyAlerts, loadMessages(config));
    if (report) parts.push(report);
    state.replyAlerts = {};
    logEvent('reminder', { ...common, trigger: 'report', withReport: report !== null }, { config, env });
    state.promptAtLastReminder = state.promptCount;
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
