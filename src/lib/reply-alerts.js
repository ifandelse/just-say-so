// Reply-check bookkeeping for outputCheck.mode "warn". The Stop hook records
// error-level alerts from each reply as per-rule counts; the next rules
// injection (interval reminder, resume, compaction) carries a short report
// and resets the counts. Nothing is delivered on its own schedule, so the
// engineer never sees a rewrite of a reply they already read.
import { fill } from './rules.js';
import { alertKey } from './vale.js';

const MAX_REPORT_LINES = 10;
const SHORT_MATCH_MAX = 24;

// Whether the Stop hook lints replies at all, and what it does with the
// result. "warn" needs a scheduled reminder to deliver through; without one
// the lint would run on every Stop for nothing, so it is "idle" instead.
export function replyCheckMode(config) {
  const mode = config.outputCheck?.mode ?? 'off';
  if (mode === 'warn' && (config.reminder?.mode ?? 'off') === 'off') return 'idle';
  return mode;
}

// A short, fixed match (a banned word, a filler phrase, a punctuation mark)
// names the problem and quotes nothing worth revising. A longer match, or
// one with sentence punctuation inside it, is a span of the old reply:
// a semicolon rule matches to the end of the sentence, a frame rule matches
// the frame plus whatever filled it. The report must not carry those.
export function isShortMatch(match) {
  const m = String(match ?? '').trim();
  if (m.length === 0) return false;
  if (/^[^\w\s]+$/.test(m)) return true; // a bare punctuation mark
  return m.length <= SHORT_MATCH_MAX && !/[,.;:!?]/.test(m);
}

// Vale substitutes the match into the message, so a long match would reach
// the report a second time through it.
function elide(message, match) {
  const msg = String(message ?? '');
  const m = String(match ?? '');
  return m.length > 0 && msg.includes(m) ? msg.split(m).join('…') : msg;
}

// Two styles that flag the same span (ai-tells and JustSaySo both ban
// "leverage") are one problem, not two. Keep the JustSaySo alert when one
// is in the group, otherwise the first.
export function dedupeOverlaps(alerts) {
  const groups = new Map();
  for (const a of alerts) {
    const key = `${a.Line}|${a.Span?.[0]}|${a.Span?.[1]}`;
    const held = groups.get(key);
    if (!held || (!String(held.Check).startsWith('JustSaySo.') && String(a.Check).startsWith('JustSaySo.'))) {
      groups.set(key, a);
    }
  }
  return [...groups.values()];
}

// Returns a new counts object; the caller stores it on the session state.
// A short match keys its own line (rule + lowercased match); a long one
// folds into a single line for the rule.
export function recordReplyAlerts(counts, alerts) {
  const out = { ...(counts ?? {}) };
  for (const a of dedupeOverlaps(alerts)) {
    const short = isShortMatch(a.Match);
    const key = short ? alertKey(a) : String(a.Check);
    const prev = out[key];
    out[key] = {
      check: a.Check,
      match: prev?.match ?? (short ? String(a.Match).trim() : null), // first spelling seen stays
      message: prev?.message ?? (short ? String(a.Message ?? '') : elide(a.Message, a.Match)),
      count: (prev?.count ?? 0) + 1
    };
  }
  return out;
}

// The report names rules and counts, and quotes a match only when it is a
// short fixed term. Returns null when there is nothing to report.
export function formatReplyReport(counts, messages) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) return null;
  entries.sort(([ka, a], [kb, b]) => b.count - a.count || ka.localeCompare(kb));
  const shown = entries.slice(0, MAX_REPORT_LINES);
  const lines = shown.map(([, e]) => {
    const what = e.match ? `${e.check} "${e.match}"` : e.check;
    return `  - ${what} (${e.count}): ${e.message}`;
  });
  if (entries.length > shown.length) {
    lines.push(`  ${fill(messages.replyReportMore, { n: entries.length - shown.length })}`);
  }
  return [messages.replyReportIntro, ...lines, messages.replyReportInstruction].join('\n');
}
