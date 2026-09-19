function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Models write curly quotes; normalize so "it's" matches "it’s".
function normalize(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

// Hyphen counts as a word character at the boundary, so "robust" does not
// match inside "robust-websocket" and terms never match inside identifiers.
const BEFORE = '(?<![\\w-])';
const AFTER = '(?![\\w-])';

// One regex builder for words and phrases: tokens split on space/hyphen and
// rejoined tolerant of either, so "load bearing" also catches "load-bearing".
export function termRegex(term) {
  const tokens = normalize(term).split(/[\s-]+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(BEFORE + tokens.join('[\\s\\u00A0-]+') + AFTER, 'gi');
}

function matchSpans(text, regex) {
  const spans = [];
  for (const m of text.matchAll(regex)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function insideAny([start, end], ranges) {
  return ranges.some(([s, e]) => start >= s && end <= e);
}

// Matches that sit inside an allowed collocation ("robust regression") are
// legitimate domain usage per the rules; they don't count.
function countOutsideAllowed(text, regex, allowedRanges) {
  const spans = matchSpans(text, regex);
  if (allowedRanges.length === 0) return spans.length;
  return spans.filter((span) => !insideAny(span, allowedRanges)).length;
}

function ensureGlobal(flags) {
  const f = flags || 'i';
  return f.includes('g') ? f : f + 'g';
}

/**
 * Scan text against a banned-term set ({words, phrases, patterns, contextual,
 * allow}). Returns { hard, soft }: hard violations warrant enforcement; soft
 * entries carry a condition a matcher cannot judge (the empty intensifiers)
 * and only ever produce advisories. Matches inside an `allow` phrase are
 * skipped entirely.
 */
export function findViolations(text, banned) {
  const t = normalize(text);
  const hard = [];
  const soft = [];
  const allowedRanges = (banned?.allow ?? []).flatMap((phrase) => matchSpans(t, termRegex(phrase)));

  for (const group of ['words', 'phrases']) {
    for (const entry of banned?.[group] ?? []) {
      const count = countOutsideAllowed(t, termRegex(entry.term), allowedRanges);
      if (count > 0) {
        hard.push({ kind: group === 'words' ? 'word' : 'phrase', term: entry.term, count, hint: entry.hint });
      }
    }
  }

  for (const entry of banned?.patterns ?? []) {
    let regex;
    try {
      regex = new RegExp(entry.regex, ensureGlobal(entry.flags));
    } catch {
      continue; // a bad user-supplied pattern must not break the check
    }
    const count = countOutsideAllowed(t, regex, allowedRanges);
    if (count > 0) hard.push({ kind: 'pattern', term: entry.label ?? entry.regex, count });
  }

  for (const entry of banned?.contextual ?? []) {
    const count = countOutsideAllowed(t, termRegex(entry.term), allowedRanges);
    if (count > 0) soft.push({ kind: 'contextual', term: entry.term, count, note: entry.note });
  }

  return { hard, soft };
}

export function formatViolations(hard, soft) {
  const lines = [];
  for (const v of hard) {
    const label = v.kind === 'pattern' ? v.term : `"${v.term}"`;
    lines.push(`  - ${label} ×${v.count}${v.hint ? ` — ${v.hint}` : ''}`);
  }
  if (soft.length) {
    const terms = soft.map((v) => `"${v.term}" ×${v.count}`).join(', ');
    lines.push(`  - advisories (replace with a measurement or a concrete consequence): ${terms}`);
  }
  return lines.join('\n');
}
