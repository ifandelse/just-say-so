// UserPromptSubmit logic: inject the condensed rules when a trigger is due,
// with the reply-check report appended when counts are waiting. Two
// triggers: the configured interval (prompts or tokens), and, when the
// reply check delivers on the next prompt, counts recorded since the last
// injection. Any firing resets the interval, so the two never stack.
// Returns the hook output object, or null for silence.
import { loadConfig, DEFAULTS } from '../config.js';
import { readRules, loadMessages } from '../rules.js';
import { readSession, writeSession } from '../state.js';
import { contextSize } from '../transcript.js';
import { formatReplyReport, replyCheckMode, deliversNextPrompt } from '../reply-alerts.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const sessionId = input.session_id ?? 'unknown';
  const state = readSession(sessionId, env);
  state.promptCount = (state.promptCount ?? 0) + 1;
  // Prompt events carry a trustworthy cwd; record it so hooks whose events
  // don't (Stop, seen live) can still find the project config.
  if (input.cwd) state.projectDir = input.cwd;

  const mode = config.reminder.mode;
  const countsWaiting = Object.keys(state.replyAlerts ?? {}).length > 0;
  let fire = countsWaiting && replyCheckMode(config) === 'warn' && deliversNextPrompt(config);
  let ctx = null;

  if (mode === 'prompts') {
    const n = Math.max(1, Number(config.reminder.everyPrompts) || DEFAULTS.reminder.everyPrompts);
    fire = fire || state.promptCount - (state.promptAtLastReminder ?? 0) >= n;
  } else if (mode === 'tokens') {
    ctx = contextSize(input.transcript_path);
    if (ctx !== null) {
      if (state.contextAtLastReminder == null) {
        // First sight of this session: set the baseline, don't fire on growth.
        state.contextAtLastReminder = ctx;
      } else {
        const threshold = Math.max(1, Number(config.reminder.everyTokens) || 4000);
        fire = fire || ctx - state.contextAtLastReminder >= threshold;
      }
    }
  }

  let output = null;
  if (fire) {
    const parts = [readRules('condensed', config)];
    // The report rides the rules, never a schedule of its own: the counts
    // wait here until the rules go out.
    const report = formatReplyReport(state.replyAlerts, loadMessages(config));
    if (report) {
      parts.push(report);
      state.replyAlerts = {};
    }
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
