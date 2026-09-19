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

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function ensureGlobal(flags) {
  const f = flags || 'i';
  return f.includes('g') ? f : f + 'g';
}

/**
 * Scan text against a banned-term set ({words, phrases, patterns, contextual}).
 * Returns { hard, soft }: hard violations warrant enforcement; soft entries
 * carry a condition a matcher cannot judge ("unless quantified") and only
 * ever produce advisories.
 */
export function findViolations(text, banned) {
  const t = normalize(text);
  const hard = [];
  const soft = [];

  for (const group of ['words', 'phrases']) {
    for (const entry of banned?.[group] ?? []) {
      const count = countMatches(t, termRegex(entry.term));
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
    const count = countMatches(t, regex);
    if (count > 0) hard.push({ kind: 'pattern', term: entry.label ?? entry.regex, count });
  }

  for (const entry of banned?.contextual ?? []) {
    const count = countMatches(t, termRegex(entry.term));
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
    lines.push(`  - advisories (banned unless quantified): ${terms}`);
  }
  return lines.join('\n');
}
