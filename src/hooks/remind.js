#!/usr/bin/env node
// UserPromptSubmit: inject the condensed rules on the configured interval.
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { loadConfig } from '../lib/config.js';
import { readRules } from '../lib/rules.js';
import { readSession, writeSession } from '../lib/state.js';
import { contextSize } from '../lib/transcript.js';

runHook(async () => {
  const input = await readStdinJson();
  const config = loadConfig(input.cwd);
  const sessionId = input.session_id ?? 'unknown';
  const state = readSession(sessionId);
  state.promptCount = (state.promptCount ?? 0) + 1;

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

  const notes = state.pendingNotes ?? [];
  if (fire || notes.length > 0) {
    const parts = [];
    if (notes.length > 0) {
      parts.push(notes.join('\n'));
      state.pendingNotes = [];
    }
    if (fire) {
      parts.push(readRules('condensed', config));
      if (mode === 'tokens' && ctx !== null) state.contextAtLastReminder = ctx;
    }
    emit({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parts.join('\n\n').trim()
      }
    });
  }

  writeSession(sessionId, state);
});
