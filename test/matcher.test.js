import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findViolations, termRegex, formatViolations } from '../src/lib/matcher.js';

const banned = {
  words: [
    { term: 'leverage', hint: 'use a concrete verb: use, apply, rely on' },
    { term: 'robust' },
    { term: 'cutting-edge' }
  ],
  phrases: [{ term: 'load bearing' }, { term: 'in order to', hint: 'use "to"' }],
  patterns: [
    {
      regex:
        "\\b(?:it|this|that|he|she|they|we)(?:'s|'re| is| are| was| were)(?: actually)? not (?:just |only |merely |simply )?[^.,;:!?\\n]{1,80}?[,;:—–]\\s*(?:it|this|that|he|she|they|we)(?:'s|'re| is| are| was| were)\\b",
      flags: 'i',
      label: '"it\'s not {x}, it\'s {y}" frame'
    }
  ],
  contextual: [{ term: 'very', note: 'empty intensifier — banned unless quantified' }]
};

test('finds words, phrases, and contextual terms in one pass', () => {
  const text = 'We leverage a robust, load-bearing design in order to ship a very fast build.';
  assert.deepEqual(findViolations(text, banned), {
    hard: [
      { kind: 'word', term: 'leverage', count: 1, hint: 'use a concrete verb: use, apply, rely on' },
      { kind: 'word', term: 'robust', count: 1, hint: undefined },
      { kind: 'phrase', term: 'load bearing', count: 1, hint: undefined },
      { kind: 'phrase', term: 'in order to', count: 1, hint: 'use "to"' }
    ],
    soft: [{ kind: 'contextual', term: 'very', count: 1, note: 'empty intensifier — banned unless quantified' }]
  });
});

test('clean text produces no violations', () => {
  assert.deepEqual(findViolations('The scheduler retries the job three times.', banned), {
    hard: [],
    soft: []
  });
});

test('word boundaries: no match inside identifiers or longer words', () => {
  assert.deepEqual(findViolations("import ws from 'robust-websocket'; // robustness matters", banned), {
    hard: [],
    soft: []
  });
  assert.deepEqual(findViolations('leverageFactor = 2', banned), { hard: [], soft: [] });
  // "every" must not trip the contextual "very"
  assert.deepEqual(findViolations('Check every branch.', banned), { hard: [], soft: [] });
});

test('matching is case-insensitive and counts occurrences', () => {
  const { hard } = findViolations('Leverage this. Then leverage that. LEVERAGE everything.', banned);
  assert.deepEqual(hard, [
    { kind: 'word', term: 'leverage', count: 3, hint: 'use a concrete verb: use, apply, rely on' }
  ]);
});

test('phrases tolerate hyphen/space variation both directions', () => {
  assert.equal(findViolations('a load-bearing wall', banned).hard.length, 1);
  assert.equal(findViolations('a load bearing wall', banned).hard.length, 1);
  assert.equal(findViolations('cutting edge tooling', banned).hard.length, 1);
  assert.equal(findViolations('cutting-edge tooling', banned).hard.length, 1);
});

test('the "not x, it\'s y" frame matches, including curly apostrophes', () => {
  const straight = findViolations("It's not a bug, it's a feature.", banned);
  assert.equal(straight.hard.length, 1);
  assert.equal(straight.hard[0].kind, 'pattern');

  const curly = findViolations('It’s not speed — it’s correctness.', banned);
  assert.equal(curly.hard.length, 1);
});

test('the frame pattern does not fire without a clause separator', () => {
  assert.deepEqual(findViolations('It is not clear that it is safe.', banned), {
    hard: [],
    soft: []
  });
});

test('a broken user-supplied pattern is skipped, not fatal', () => {
  const withBad = { ...banned, patterns: [{ regex: '([unclosed', label: 'bad' }] };
  assert.deepEqual(findViolations('anything', withBad), { hard: [], soft: [] });
});

test('termRegex escapes regex metacharacters in terms', () => {
  assert.equal(termRegex('c++ style').test('we prefer c++ style here'), true);
});

test('formatViolations renders hints and advisories', () => {
  const { hard, soft } = findViolations('We leverage this very often.', banned);
  assert.equal(
    formatViolations(hard, soft),
    '  - "leverage" ×1 — use a concrete verb: use, apply, rely on\n' +
      '  - advisories (banned unless quantified): "very" ×1'
  );
});
