// SessionStart logic: re-inject the condensed rules when context was rebuilt
// (compaction summarizes the rules away), keep session state honest, and say
// so — once, here — when checks are configured but the vale binary is
// missing, or when the reply check has no reminder to deliver through. The
// checks themselves stay silent about it; a policy that fails quietly on
// every edit is worse than one line at startup.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { readRules, loadMessages } from '../rules.js';
import { readSession, writeSession, resetSession, cleanupSessions } from '../state.js';
import { probeVale } from '../vale.js';
import { replyCheckMode, formatReplyReport } from '../reply-alerts.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const source = input.source ?? 'startup';
  const sessionId = input.session_id ?? 'unknown';
  const messages = loadMessages(config);
  const replyMode = replyCheckMode(config);
  const injectRules = (config.reminder.onSessionStart ?? []).includes(source);

  // Read the reply counts before any reset: the post-compaction injection
  // is the first rules delivery after they were recorded, so it carries them.
  const before = readSession(sessionId, env);
  const report = injectRules ? formatReplyReport(before.replyAlerts, messages) : null;

  // Context was rebuilt: counters and token baselines are stale either way.
  if (source === 'compact' || source === 'clear') resetSession(sessionId, env);
  else if (report) writeSession(sessionId, { ...before, replyAlerts: {} }, env);
  cleanupSessions(env);

  const checksOn = config.bannedCheck.mode !== 'off' || replyMode === 'warn' || replyMode === 'block';
  const notices = [];
  if (checksOn && !probeVale(env)) notices.push(messages.valeMissing);
  if (replyMode === 'idle') notices.push(messages.replyCheckIdle);

  if (!injectRules && notices.length === 0) return null;

  const out = {};
  if (notices.length > 0) out.systemMessage = notices.join('\n');
  if (injectRules) {
    const parts = [readRules('condensed', config)];
    if (report) parts.push(report);
    out.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: parts.map((p) => p.trim()).join('\n\n')
    };
  }
  return out;
}
