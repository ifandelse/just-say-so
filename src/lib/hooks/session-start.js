// SessionStart logic: re-inject the condensed rules when context was rebuilt
// (compaction summarizes the rules away), keep session state honest, and say
// so — once, here — when checks are configured but the vale binary is
// missing, or when the reply check has no reminder to deliver through. The
// checks themselves stay silent about it; a policy that fails quietly on
// every edit is worse than one line at startup.
// Returns the hook output object, or null for silence.
import { loadConfig } from '../config.js';
import { readRules, loadMessages, fill } from '../rules.js';
import { readSession, writeSession, resetSession, cleanupSessions } from '../state.js';
import { probeVale, resolveValeConfig, inspectValeConfig } from '../vale.js';
import { replyCheckMode, formatReplyReport } from '../reply-alerts.js';
import { logEvent, eventsOn } from '../events.js';

// The slice of config a reply event joins to by session id.
function configSnapshot(config) {
  return {
    reminder: { mode: config.reminder?.mode ?? null, everyPrompts: config.reminder?.everyPrompts ?? null },
    outputCheck: { mode: config.outputCheck?.mode ?? null, deliver: config.outputCheck?.deliver ?? null },
    bannedCheck: { mode: config.bannedCheck?.mode ?? null },
    vale: { levels: config.vale?.levels ?? null }
  };
}

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
  else if (injectRules) {
    // The rules just went out, so the interval measures from here: the
    // prompt baseline moves to now, and the token baseline clears so the
    // next prompt re-reads context size without firing. Without this a
    // resume one prompt short of the interval would inject twice in a row.
    writeSession(
      sessionId,
      { ...before, replyAlerts: {}, promptAtLastReminder: before.promptCount, contextAtLastReminder: null },
      env
    );
  }
  cleanupSessions(env);

  const checksOn = config.bannedCheck.mode !== 'off' || replyMode === 'warn' || replyMode === 'block';
  // The log lints replies even with the checks off, so it wants the probe too.
  const valeFound = checksOn || eventsOn(config) ? probeVale(env) : null;
  const notices = [];
  if (checksOn && valeFound === false) notices.push(messages.valeMissing);
  // The names changed in 0.9.0: a [*.chat.md] section from an older config
  // matches nothing now, and a config without the [formats] mapping lints
  // chat as plain text. Both are quiet failures, so this is the one place
  // that says so.
  if (checksOn && valeFound) {
    const seen = inspectValeConfig(resolveValeConfig(input.cwd, config), env);
    if (seen?.chatSections.length > 0) {
      notices.push(fill(messages.valeChatSectionDead, { sections: seen.chatSections.map((g) => `[${g}]`).join(', ') }));
    }
    if (seen && !seen.formatsMapped) notices.push(messages.valeFormatsMissing);
  }
  if (replyMode === 'idle') notices.push(messages.replyCheckIdle);

  const project = input.cwd ?? null;
  const promptIndex = source === 'compact' || source === 'clear' ? 0 : before.promptCount;
  logEvent('session', { session: sessionId, project, source, vale: valeFound, config: configSnapshot(config) }, { config, env });
  if (injectRules) {
    logEvent(
      'reminder',
      { session: sessionId, project, promptIndex, trigger: 'session', withReport: report !== null },
      { config, env }
    );
  }

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
