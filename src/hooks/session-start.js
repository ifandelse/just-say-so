#!/usr/bin/env node
// SessionStart: re-inject the condensed rules when context was rebuilt
// (compaction summarizes the rules away) and keep session state honest.
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { loadConfig } from '../lib/config.js';
import { readRules } from '../lib/rules.js';
import { resetSession, cleanupSessions } from '../lib/state.js';

runHook(async () => {
  const input = await readStdinJson();
  const config = loadConfig(input.cwd);
  const source = input.source ?? 'startup';
  const sessionId = input.session_id ?? 'unknown';

  // Context was rebuilt: counters and token baselines are stale either way.
  if (source === 'compact' || source === 'clear') resetSession(sessionId);
  cleanupSessions();

  if ((config.reminder.onSessionStart ?? []).includes(source)) {
    emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: readRules('condensed', config)
      }
    });
  }
});
