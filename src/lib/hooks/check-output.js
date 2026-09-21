// Stop logic: check the final assistant message for banned terms. Off by
// default — chat prose never passes through PreToolUse, and this closes that
// gap for users who want it. "block" forces a rewrite; "warn" queues a note
// that the remind hook delivers with the next prompt.
// Returns the hook output object, or null for silence.
import { loadConfig, findProjectConfig } from '../config.js';
import { loadBanned, loadMessages } from '../rules.js';
import { findViolations, formatViolations } from '../matcher.js';
import { lastAssistantText } from '../transcript.js';
import { readSession, writeSession } from '../state.js';

const MAX_PENDING_NOTES = 3;

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
  const mode = config.outputCheck.mode;
  if (mode === 'off') return null;
  if (input.stop_hook_active) return null; // never loop on our own rewrite

  // The transcript file is written asynchronously and can lag the turn, so
  // the docs say Stop hooks should read last_assistant_message instead.
  // Fall back to the transcript for harnesses that don't send the field.
  const text =
    typeof input.last_assistant_message === 'string' && input.last_assistant_message.length > 0
      ? input.last_assistant_message
      : lastAssistantText(input.transcript_path);
  if (!text) return null;

  const { hard } = findViolations(text, loadBanned(config));
  if (hard.length === 0) return null;

  const messages = loadMessages(config);
  const message =
    `${messages.outputIntro}\n${formatViolations(hard, [], messages.advisoryLabel)}\n${messages.outputRewrite}`;

  if (mode === 'block') {
    return { decision: 'block', reason: message };
  }
  const state = readSession(sessionId, env);
  state.pendingNotes = [...(state.pendingNotes ?? []), message].slice(-MAX_PENDING_NOTES);
  writeSession(sessionId, state, env);
  return null;
}
