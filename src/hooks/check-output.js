#!/usr/bin/env node
// Stop: check the final assistant message for banned terms. Off by default —
// chat prose never passes through PreToolUse, and this closes that gap for
// users who want it. "block" forces a rewrite; "warn" queues a note that
// remind.js delivers with the next prompt.
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { loadConfig } from '../lib/config.js';
import { loadBanned } from '../lib/rules.js';
import { findViolations, formatViolations } from '../lib/matcher.js';
import { lastAssistantText } from '../lib/transcript.js';
import { readSession, writeSession } from '../lib/state.js';

const MAX_PENDING_NOTES = 3;

runHook(async () => {
  const input = await readStdinJson();
  const config = loadConfig(input.cwd);
  const mode = config.outputCheck.mode;
  if (mode === 'off') return;
  if (input.stop_hook_active) return; // never loop on our own rewrite

  const text = lastAssistantText(input.transcript_path);
  if (!text) return;

  const { hard } = findViolations(text, loadBanned(config));
  if (hard.length === 0) return;

  const message =
    `just-say-so: your last reply contains banned terms:\n${formatViolations(hard, [])}\n` +
    'Rewrite the reply per the communication rules.';

  if (mode === 'block') {
    emit({ decision: 'block', reason: message });
  } else {
    const sessionId = input.session_id ?? 'unknown';
    const state = readSession(sessionId);
    state.pendingNotes = [...(state.pendingNotes ?? []), message].slice(-MAX_PENDING_NOTES);
    writeSession(sessionId, state);
  }
});
