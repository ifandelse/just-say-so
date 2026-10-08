// Reply-check bookkeeping for outputCheck.mode "warn". The Stop hook records
// error-level alerts from each reply as per-rule counts; the next rules
// injection (interval reminder, resume, compaction) carries a short report
// and resets the counts. Nothing is delivered on its own schedule, so the
// engineer never sees a rewrite of a reply they already read.
import { fill } from './rules.js';
import { alertKey, truncateMatch } from './vale.js';

const MAX_REPORT_LINES = 10;

// Whether the Stop hook lints replies at all, and what it does with the
// result. "warn" needs a scheduled reminder to deliver through; without one
// the lint would run on every Stop for nothing, so it is "idle" instead.
export function replyCheckMode(config) {
  const mode = config.outputCheck?.mode ?? 'off';
  if (mode === 'warn' && (config.reminder?.mode ?? 'off') === 'off') return 'idle';
  return mode;
}

// Returns a new counts object; the caller stores it on the session state.
export function recordReplyAlerts(counts, alerts) {
  const out = { ...(counts ?? {}) };
  for (const a of alerts) {
    // Keyed by rule + match, so a banned word inside a one-rule-many-tokens
    // style still gets its own line.
    const key = alertKey(a);
    const prev = out[key];
    out[key] = {
      check: a.Check,
      match: prev?.match ?? truncateMatch(a.Match), // first spelling seen stays
      message: String(a.Message ?? ''),
      count: (prev?.count ?? 0) + 1
    };
  }
  return out;
}

// The report names rules and counts, never the old text: a quoted sentence
// invites the model to fix that reply, and the whole point is to leave it
// alone. Returns null when there is nothing to report.
export function formatReplyReport(counts, messages) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return null;
  entries.sort(([ka, a], [kb, b]) => b.count - a.count || ka.localeCompare(kb));
  const shown = entries.slice(0, MAX_REPORT_LINES);
  const lines = shown.map(([, e]) => `  - ${e.check} "${e.match}" (${e.count}): ${e.message}`);
  if (entries.length > shown.length) {
    lines.push(`  ${fill(messages.replyReportMore, { n: entries.length - shown.length })}`);
  }
  return [messages.replyReportIntro, ...lines, messages.replyReportInstruction].join('\n');
}
