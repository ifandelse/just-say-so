// UserPromptSubmit logic: inject the condensed rules on the configured
// interval, with the reply-check report appended when counts are waiting.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { readRules, loadMessages } from '../rules.js';
import { readSession, writeSession } from '../state.js';
import { contextSize } from '../transcript.js';
import { formatReplyReport } from '../reply-alerts.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const sessionId = input.session_id ?? 'unknown';
  const state = readSession(sessionId, env);
  state.promptCount = (state.promptCount ?? 0) + 1;
  // Prompt events carry a trustworthy cwd; record it so hooks whose events
  // don't (Stop, seen live) can still find the project config.
  if (input.cwd) state.projectDir = input.cwd;

  const mode = config.reminder.mode;
  let fire = false;
  let ctx = null;

  if (mode === 'prompts') {
    const n = Math.max(1, Number(config.reminder.everyPrompts) || 5);
    fire = state.promptCount % n === 0;
  } else if (mode === 'tokens') {
    ctx = contextSize(input.transcript_path);
    if (ctx !== null) {
      if (state.contextAtLastReminder == null) {
        // First sight of this session: set the baseline, don't fire.
        state.contextAtLastReminder = ctx;
      } else {
        const threshold = Math.max(1, Number(config.reminder.everyTokens) || 4000);
        fire = ctx - state.contextAtLastReminder >= threshold;
      }
    }
  }

  let output = null;
  if (fire) {
    const parts = [readRules('condensed', config)];
    // The report rides the reminder, never a schedule of its own: the counts
    // wait here until the rules go out again.
    const report = formatReplyReport(state.replyAlerts, loadMessages(config));
    if (report) {
      parts.push(report);
      state.replyAlerts = {};
    }
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
