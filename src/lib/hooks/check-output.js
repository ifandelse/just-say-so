// Stop logic: check the final assistant message for banned terms. Off by
// default — chat prose never passes through PreToolUse, and this closes that
// gap for users who want it. "block" forces a rewrite; "warn" queues a note
// that the remind hook delivers with the next prompt.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { loadBanned, loadMessages } from '../rules.js';
import { findViolations, formatViolations } from '../matcher.js';
import { lastAssistantText } from '../transcript.js';
import { readSession, writeSession } from '../state.js';

const MAX_PENDING_NOTES = 3;

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const mode = config.outputCheck.mode;
  if (mode === 'off') return null;
  if (input.stop_hook_active) return null; // never loop on our own rewrite

  const text = lastAssistantText(input.transcript_path);
  if (!text) return null;

  const { hard } = findViolations(text, loadBanned(config));
  if (hard.length === 0) return null;

  const messages = loadMessages(config);
  const message =
    `${messages.outputIntro}\n${formatViolations(hard, [], messages.advisoryLabel)}\n${messages.outputRewrite}`;

  if (mode === 'block') {
    return { decision: 'block', reason: message };
  }
  const sessionId = input.session_id ?? 'unknown';
  const state = readSession(sessionId, env);
  state.pendingNotes = [...(state.pendingNotes ?? []), message].slice(-MAX_PENDING_NOTES);
  writeSession(sessionId, state, env);
  return null;
}
