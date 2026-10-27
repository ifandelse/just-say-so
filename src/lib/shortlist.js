// The shortlist: the few rules worth the model's judgment for one tag,
// scored by word overlap between the tag and its typed reasons on one side
// and the rule's id and message on the other. Lexical on purpose: it is
// deterministic, it prints its score, and an empty result means this
// search found nothing, not that no rule exists.

const STOP = new Set(
  (
    'a an the and or but of to in on at for with without from by as is are was were be been being it its this that these those ' +
    'not no do does did done use using used you your we our they their he she his her i my me too very so than then there here ' +
    'when where which who whom what why how all any each every some such only own same more most other into over under again ' +
    'further once about above after before below between both during off out up down while until just also can will would should ' +
    'could may might must shall ai prose text reply replies say says said one two'
  ).split(' ')
);

// A plural loses its trailing s, so "terms" meets "term" and "acronyms"
// meets "acronym". Nothing subtler: this is a shortlist, not a search.
function stem(w) {
  return w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/** Lowercase word tokens, with rule ids split on dots, capitals, and hyphens. */
export function tokenize(text) {
  return [
    ...new Set(
      String(text ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOP.has(w))
        .map(stem)
    )
  ];
}

const TAG_WEIGHT = 2;
const REASON_WEIGHT = 1;
export const DEFAULT_FLOOR = 2;
export const DEFAULT_LIMIT = 10;

/**
 * Score `rules` ([{ id, message, ... }]) against a tag and its reasons.
 * Returns the top `limit` with score >= floor, highest first, ties by id.
 * Each hit carries the rule and the matched words.
 */
export function shortlist(tag, reasons, rules, { limit = DEFAULT_LIMIT, floor = DEFAULT_FLOOR } = {}) {
  const tagWords = new Set(tokenize(tag));
  const reasonWords = new Set();
  for (const r of reasons ?? []) for (const w of tokenize(r)) if (!tagWords.has(w)) reasonWords.add(w);
  if (tagWords.size === 0 && reasonWords.size === 0) return [];
  const hits = [];
  for (const rule of rules ?? []) {
    const words = new Set(tokenize(`${rule.id} ${rule.message ?? ''}`));
    const matched = [];
    let score = 0;
    for (const w of tagWords) if (words.has(w)) { score += TAG_WEIGHT; matched.push(w); }
    for (const w of reasonWords) if (words.has(w)) { score += REASON_WEIGHT; matched.push(w); }
    if (score >= floor) hits.push({ ...rule, score, matched: matched.sort() });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
