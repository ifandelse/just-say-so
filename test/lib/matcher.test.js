import { describe, it, expect, beforeEach } from 'vitest';
import { findViolations, termRegex, formatViolations } from '../../src/lib/matcher.js';

/*
 * Branch map — src/lib/matcher.js
 *   normalize: curly → straight quotes
 *   termRegex: single token · multi token (space/hyphen tolerant) · metacharacter escape
 *   findViolations: word hit/miss (boundaries) · phrase hit · pattern hit ·
 *                   invalid pattern regex → skipped · flags without "g" → ensureGlobal ·
 *                   contextual hit · empty/absent groups ·
 *                   allow ranges empty (fast path) · match inside allowed phrase skipped ·
 *                   match outside allowed phrase counted
 *   formatViolations: word/phrase label (quoted) vs pattern label · hint present/absent ·
 *                     soft empty vs non-empty
 */

const BANNED = {
  words: [
    { term: 'leverage', hint: 'use a concrete verb: use, apply, rely on' },
    { term: 'robust' },
    { term: 'cutting-edge' }
  ],
  phrases: [{ term: 'load bearing' }],
  patterns: [
    {
      regex:
        "\\b(?:it|this|that|he|she|they|we)(?:'s|'re| is| are| was| were)(?: actually)? not (?:just |only |merely |simply )?[^.,;:!?\\n]{1,80}?[,;:—–]\\s*(?:it|this|that|he|she|they|we)(?:'s|'re| is| are| was| were)\\b",
      flags: 'i',
      label: '"it\'s not {x}, it\'s {y}" frame'
    }
  ],
  contextual: [{ term: 'very', note: 'empty intensifier — replace with a measurement or a concrete consequence' }]
};

describe('matcher', () => {
  describe('findViolations', () => {
    describe('when the text hits words, phrases, and contextual terms', () => {
      let result;

      beforeEach(() => {
        result = findViolations('We leverage a robust, load-bearing design. Very nice.', BANNED);
      });

      it('should report each in group order with counts and hints', () => {
        expect(result).toEqual({
          hard: [
            { kind: 'word', term: 'leverage', count: 1, hint: 'use a concrete verb: use, apply, rely on' },
            { kind: 'word', term: 'robust', count: 1, hint: undefined },
            { kind: 'phrase', term: 'load bearing', count: 1, hint: undefined }
          ],
          soft: [
            { kind: 'contextual', term: 'very', count: 1, note: 'empty intensifier — replace with a measurement or a concrete consequence' }
          ]
        });
      });
    });

    describe('when the text is clean', () => {
      let result;

      beforeEach(() => {
        result = findViolations('The scheduler retries the job three times.', BANNED);
      });

      it('should report nothing', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when banned terms appear inside identifiers or longer words', () => {
      let result;

      beforeEach(() => {
        result = findViolations(
          "import ws from 'robust-websocket'; // robustness. leverageFactor = 2. Check every branch.",
          BANNED
        );
      });

      it('should not match across word boundaries', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when the same term repeats with mixed case', () => {
      let result;

      beforeEach(() => {
        result = findViolations('Leverage this. Then leverage that. LEVERAGE everything.', BANNED);
      });

      it('should count all occurrences under one violation', () => {
        expect(result.hard).toEqual([
          { kind: 'word', term: 'leverage', count: 3, hint: 'use a concrete verb: use, apply, rely on' }
        ]);
      });
    });

    describe('when hyphen/space variants of a term appear', () => {
      let counts;

      beforeEach(() => {
        counts = [
          'a load-bearing wall',
          'a load bearing wall',
          'cutting edge tooling',
          'cutting-edge tooling'
        ].map((text) => findViolations(text, BANNED).hard.length);
      });

      it('should match every variant', () => {
        expect(counts).toEqual([1, 1, 1, 1]);
      });
    });

    describe('when the frame pattern matches, with curly apostrophes and em dash', () => {
      let straight, curly;

      beforeEach(() => {
        straight = findViolations("It's not a bug, it's a feature.", BANNED);
        curly = findViolations('It’s not speed — it’s correctness.', BANNED);
      });

      it('should report the pattern by its label', () => {
        expect(straight.hard).toEqual([
          { kind: 'pattern', term: '"it\'s not {x}, it\'s {y}" frame', count: 1 }
        ]);
        expect(curly.hard).toEqual([
          { kind: 'pattern', term: '"it\'s not {x}, it\'s {y}" frame', count: 1 }
        ]);
      });
    });

    describe('when a sentence lacks the frame separator', () => {
      let result;

      beforeEach(() => {
        result = findViolations('It is not clear that it is safe.', BANNED);
      });

      it('should not fire the pattern', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when a pattern regex is invalid', () => {
      let result;

      beforeEach(() => {
        result = findViolations('anything', { patterns: [{ regex: '([unclosed', label: 'BAD' }] });
      });

      it('should skip the pattern instead of throwing', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when a pattern already carries the "g" flag', () => {
      let result;

      beforeEach(() => {
        result = findViolations('zap zap', { patterns: [{ regex: 'zap', flags: 'gi', label: 'ZAP' }] });
      });

      it('should count matches without doubling the flag', () => {
        expect(result.hard).toEqual([{ kind: 'pattern', term: 'ZAP', count: 2 }]);
      });
    });

    describe('when a pattern has no label and no flags', () => {
      let result;

      beforeEach(() => {
        result = findViolations('zap', { patterns: [{ regex: 'zap' }] });
      });

      it('should fall back to the regex source as the term', () => {
        expect(result.hard).toEqual([{ kind: 'pattern', term: 'zap', count: 1 }]);
      });
    });

    describe('when matches fall inside and outside an allowed phrase', () => {
      let result;

      beforeEach(() => {
        result = findViolations('We ran a robust regression, then wrote a robust plan. Very robust regression work.', {
          ...BANNED,
          allow: ['robust regression']
        });
      });

      it('should count only the matches outside the allowed collocations', () => {
        expect(result).toEqual({
          hard: [{ kind: 'word', term: 'robust', count: 1, hint: undefined }],
          soft: [
            {
              kind: 'contextual',
              term: 'very',
              count: 1,
              note: 'empty intensifier — replace with a measurement or a concrete consequence'
            }
          ]
        });
      });
    });

    describe('when every match sits inside an allowed phrase', () => {
      let result;

      beforeEach(() => {
        result = findViolations('The robust regression holds.', { ...BANNED, allow: ['robust regression'] });
      });

      it('should report nothing', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when the banned set has missing groups', () => {
      let result;

      beforeEach(() => {
        result = findViolations('a robust plan', {});
      });

      it('should report nothing', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });
  });

  describe('termRegex', () => {
    describe('when the term contains regex metacharacters', () => {
      let result;

      beforeEach(() => {
        result = termRegex('c++ style').test('we prefer c++ style here');
      });

      it('should escape them and still match', () => {
        expect(result).toBe(true);
      });
    });
  });

  describe('formatViolations', () => {
    describe('when violations carry hints and advisories exist', () => {
      let result;

      beforeEach(() => {
        const { hard, soft } = findViolations('We leverage this very often.', BANNED);
        result = formatViolations(hard, soft);
      });

      it('should render the hint and the advisory line', () => {
        expect(result).toBe(
          '  - "leverage" ×1 — use a concrete verb: use, apply, rely on\n' +
            '  - advisories (replace with a measurement or a concrete consequence): "very" ×1'
        );
      });
    });

    describe('when a pattern violation has no hint and no advisories exist', () => {
      let result;

      beforeEach(() => {
        const { hard } = findViolations("It's not a bug, it's a feature.", BANNED);
        result = formatViolations(hard, []);
      });

      it('should render the bare pattern label', () => {
        expect(result).toBe('  - "it\'s not {x}, it\'s {y}" frame ×1');
      });
    });
  });
});
