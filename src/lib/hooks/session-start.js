// SessionStart logic: inject the condensed rules at the start of a context
// (compaction summarizes the rules away), keep session state honest, and
// say so — once, here — when checks are configured but the vale binary is
// missing, when the Vale config predates the 0.9.0 names, or when a config
// file still sets 0.8.x keys. The checks themselves stay silent about it; a
// policy that fails quietly on every edit is worse than one line at startup.
// Returns the hook output object, or null for silence.
import { loadConfig, configSnapshot, publishOn, findLegacyKeys } from '../config.js';
import { loadMessages, fill } from '../rules.js';
import { contextRules, contextStartKind } from '../rule-state.js';
import { manifestProblem } from '../manifest.js';
import { readSession, writeSession, resetSession, cleanupSessions } from '../state.js';
import { probeVale, resolveValeConfig, inspectValeConfig } from '../vale.js';
import { formatReplyReport } from '../reply-alerts.js';
import { logEvent, eventsOn } from '../events.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const source = input.source ?? 'startup';
  const sessionId = input.session_id ?? 'unknown';
  const messages = loadMessages(config);
  const injectRules = (config.rules.onContextStart ?? []).includes(source);

  // Read the reply counts before any reset: the post-compaction injection
  // is the first rules delivery after they were recorded, so it carries them.
  const before = readSession(sessionId, env);
  const report = injectRules ? formatReplyReport(before.replyAlerts, messages) : null;

  // Context was rebuilt: counters and token baselines are stale either way.
  if (source === 'compact' || source === 'clear') resetSession(sessionId, env);
  else if (injectRules) {
    // The rules just went out: the counts they carried clear, and the
    // events log measures the next reply from here.
    writeSession(sessionId, { ...before, replyAlerts: {}, promptAtLastReminder: before.promptCount }, env);
  }
  cleanupSessions(env);

  const checksOn = config.files.mode !== 'off' || publishOn(config) || config.reply.mode !== 'off';
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
  for (const { file, keys } of findLegacyKeys(input.cwd, env)) {
    notices.push(fill(messages.legacyConfigKeys, { file, keys: keys.join(', ') }));
  }
  // A rules.manifest that cannot be read falls back to the shipped rules
  // in every hook; this is the one place that says so.
  const problem = manifestProblem(config, input.cwd);
  if (problem) notices.push(fill(messages.manifestUnreadable, problem));

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
    const parts = [contextRules(config, input.cwd, env, { vale: valeFound, kind: contextStartKind(config) })];
    if (report) parts.push(report);
    out.hookSpecificOutput = {
      hookEventName: 'SessionStart',
      additionalContext: parts.map((p) => p.trim()).join('\n\n')
    };
  }
  return out;
}
