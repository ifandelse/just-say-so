// SessionStart logic: re-inject the condensed rules when context was rebuilt
// (compaction summarizes the rules away), keep session state honest, and say
// so — once, here — when checks are configured but the vale binary is
// missing. The checks themselves stay silent about it; a policy that fails
// quietly on every edit is worse than one line at startup.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { readRules, loadMessages } from '../rules.js';
import { resetSession, cleanupSessions } from '../state.js';
import { probeVale } from '../vale.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const source = input.source ?? 'startup';
  const sessionId = input.session_id ?? 'unknown';

  // Context was rebuilt: counters and token baselines are stale either way.
  if (source === 'compact' || source === 'clear') resetSession(sessionId, env);
  cleanupSessions(env);

  const checksOn = config.bannedCheck.mode !== 'off' || config.outputCheck.mode !== 'off';
  const systemMessage = checksOn && !probeVale(env) ? loadMessages(config).valeMissing : null;

  const injectRules = (config.reminder.onSessionStart ?? []).includes(source);
  if (!injectRules && !systemMessage) return null;

  const out = {};
  if (systemMessage) out.systemMessage = systemMessage;
  if (injectRules) {
    out.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: readRules('condensed', config)
    };
  }
  return out;
}
