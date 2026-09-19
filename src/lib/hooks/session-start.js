// SessionStart logic: re-inject the condensed rules when context was rebuilt
// (compaction summarizes the rules away) and keep session state honest.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { readRules } from '../rules.js';
import { resetSession, cleanupSessions } from '../state.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const source = input.source ?? 'startup';
  const sessionId = input.session_id ?? 'unknown';

  // Context was rebuilt: counters and token baselines are stale either way.
  if (source === 'compact' || source === 'clear') resetSession(sessionId, env);
  cleanupSessions(env);

  if (!(config.reminder.onSessionStart ?? []).includes(source)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: readRules('condensed', config)
    }
  };
}
