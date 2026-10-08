import { describe, it, expect, beforeEach } from 'vitest';
import { replyCheckMode, isShortMatch, dedupeOverlaps, recordReplyAlerts, formatReplyReport } from './reply-alerts.js';

/*
 * Branch map — src/lib/reply-alerts.js
 *   replyCheckMode: off · block · warn with a schedule → warn · warn without
 *     one → idle · missing sections → off
 *   isShortMatch: empty → false · bare punctuation → true · short word or
 *     phrase → true · over 24 chars → false · sentence punctuation inside → false
 *   dedupeOverlaps: same line+span → one alert, JustSaySo preferred in either
 *     order · different spans → both kept · missing Span → still grouped
 *   recordReplyAlerts: short match keyed by rule|match · long match keyed by
 *     rule with the match elided from the message · repeated key increments ·
 *     null counts · missing message → "" · the issue #1 repro end to end
 *   formatReplyReport: empty → null · sorted by count then key · match-less
 *     line omits the quote · capped at 10 with a "more" line · instruction last
 */

const MESSAGES = {
  replyReportIntro: 'INTRO',
  replyReportMore: '(and {n} more)',
  replyReportInstruction: 'INSTRUCTION'
};

function alert(over = {}) {
  return { Check: 'JustSaySo.Buzzwords', Match: 'synergy', Message: "Banned buzzword: 'synergy'.", Line: 1, Span: [1, 7], ...over };
}

describe('reply-alerts', () => {
  describe('replyCheckMode', () => {
    describe('when each configuration shape is given', () => {
      let modes;

      beforeEach(() => {
        modes = {
          off: replyCheckMode({ outputCheck: { mode: 'off' }, reminder: { mode: 'prompts' } }),
          block: replyCheckMode({ outputCheck: { mode: 'block' }, reminder: { mode: 'off' } }),
          warn: replyCheckMode({ outputCheck: { mode: 'warn' }, reminder: { mode: 'tokens' } }),
          idle: replyCheckMode({ outputCheck: { mode: 'warn' }, reminder: { mode: 'off' } }),
          bare: replyCheckMode({}),
          warnNoReminder: replyCheckMode({ outputCheck: { mode: 'warn' } })
        };
      });

      it('should map each to its mode', () => {
        expect(modes).toEqual({
          off: 'off',
          block: 'block',
          warn: 'warn',
          idle: 'idle',
          bare: 'off',
          warnNoReminder: 'idle'
        });
      });
    });
  });

  describe('isShortMatch', () => {
    describe('when each match shape is given', () => {
      let results;

      beforeEach(() => {
        results = {
          empty: isShortMatch(''),
          missing: isShortMatch(undefined),
          semicolon: isShortMatch(';'),
          emDash: isShortMatch('—'),
          word: isShortMatch('leverage'),
          phrase: isShortMatch('in order to'),
          atLimit: isShortMatch('x'.repeat(24)),
          overLimit: isShortMatch('x'.repeat(25)),
          frame: isShortMatch('It is not a bug, it is'),
          sentence: isShortMatch('; we should leverage it.')
        };
      });

      it('should accept fixed terms and marks, and reject spans of the reply', () => {
        expect(results).toEqual({
          empty: false,
          missing: false,
          semicolon: true,
          emDash: true,
          word: true,
          phrase: true,
          atLimit: true,
          overLimit: false,
          frame: false,
          sentence: false
        });
      });
    });
  });

  describe('dedupeOverlaps', () => {
    describe('when two styles flag the same span', () => {
      let kept;

      beforeEach(() => {
        const ai = alert({ Check: 'ai-tells.OverusedVocabularyVerbs', Match: 'leverage', Line: 1, Span: [45, 52] });
        const jss = alert({ Check: 'JustSaySo.Leverage', Match: 'leverage', Line: 1, Span: [45, 52] });
        const other = alert({ Check: 'ai-tells.BareHolds', Match: 'holds the state', Line: 1, Span: [58, 83] });
        kept = {
          aiFirst: dedupeOverlaps([ai, jss, other]).map((a) => a.Check),
          jssFirst: dedupeOverlaps([jss, ai, other]).map((a) => a.Check),
          twoThirdParty: dedupeOverlaps([ai, { ...ai, Check: 'ai-tells.Other' }]).map((a) => a.Check),
          noSpan: dedupeOverlaps([alert({ Span: undefined }), alert({ Span: undefined })]).length
        };
      });

      it('should keep one alert per span and prefer JustSaySo', () => {
        expect(kept).toEqual({
          aiFirst: ['JustSaySo.Leverage', 'ai-tells.BareHolds'],
          jssFirst: ['JustSaySo.Leverage', 'ai-tells.BareHolds'],
          twoThirdParty: ['ai-tells.OverusedVocabularyVerbs'],
          noSpan: 1
        });
      });
    });
  });

  describe('recordReplyAlerts', () => {
    describe('when alerts repeat a key and add a new one', () => {
      let counts;

      beforeEach(() => {
        const first = recordReplyAlerts(null, [alert({ Span: [1, 7] }), alert({ Match: 'Synergy', Span: [20, 26] })]);
        counts = recordReplyAlerts(first, [alert({ Check: 'ai-tells.EmDash', Match: '—', Message: undefined, Span: [3, 3] })]);
      });

      it('should count by rule and lowercased match', () => {
        expect(counts).toEqual({
          'JustSaySo.Buzzwords|synergy': {
            check: 'JustSaySo.Buzzwords',
            match: 'synergy',
            message: "Banned buzzword: 'synergy'.",
            count: 2
          },
          'ai-tells.EmDash|—': { check: 'ai-tells.EmDash', match: '—', message: '', count: 1 }
        });
      });
    });

    describe('when the match is a span of the reply', () => {
      let counts;

      beforeEach(() => {
        const span = (text, line) =>
          alert({
            Check: 'ai-tells.SemicolonUsage',
            Match: text,
            Message: `AI punctuation: '${text}'. Replace the semicolon with a period or two sentences.`,
            Line: line,
            Span: [1, text.length]
          });
        counts = recordReplyAlerts({}, [span('; we should leverage it.', 1), span('; the parser holds it.', 2)]);
      });

      it('should fold both into one line for the rule with the quote elided', () => {
        expect(counts).toEqual({
          'ai-tells.SemicolonUsage': {
            check: 'ai-tells.SemicolonUsage',
            match: null,
            message: "AI punctuation: '…'. Replace the semicolon with a period or two sentences.",
            count: 2
          }
        });
      });
    });

    describe('when the alerts are the issue #1 repro', () => {
      let report;

      beforeEach(() => {
        const alerts = [
          { Check: 'JustSaySo.NegativeParallelism', Match: 'It is not a bug, it is', Message: "Banned frame: 'It is not a bug, it is'. State the positive claim directly.", Line: 1, Span: [1, 22] },
          { Check: 'ai-tells.SemicolonUsage', Match: '; we should leverage it. The parser holds the state.', Message: "AI punctuation: '; we should leverage it. The parser holds the state.'. Replace the semicolon with a period or two sentences.", Line: 1, Span: [33, 84] },
          { Check: 'JustSaySo.Leverage', Match: 'leverage', Message: "Banned buzzword: 'leverage'. Use a concrete verb: use, apply, rely on.", Line: 1, Span: [45, 52] },
          { Check: 'ai-tells.OverusedVocabularyVerbs', Match: 'leverage', Message: "AI vocabulary (verb form): 'leverage'. Replace with a direct verb.", Line: 1, Span: [45, 52] },
          { Check: 'ai-tells.BareHolds', Match: 'The parser holds the state', Message: "AI possession verb: 'The parser holds the state'. Say what it contains or stores.", Line: 1, Span: [58, 83] }
        ];
        report = formatReplyReport(recordReplyAlerts({}, alerts), MESSAGES);
      });

      it('should report four lines, count leverage once, and quote no span of the reply', () => {
        expect(report).toBe(
          [
            'INTRO',
            "  - ai-tells.BareHolds (1): AI possession verb: '…'. Say what it contains or stores.",
            "  - ai-tells.SemicolonUsage (1): AI punctuation: '…'. Replace the semicolon with a period or two sentences.",
            "  - JustSaySo.Leverage \"leverage\" (1): Banned buzzword: 'leverage'. Use a concrete verb: use, apply, rely on.",
            "  - JustSaySo.NegativeParallelism (1): Banned frame: '…'. State the positive claim directly.",
            'INSTRUCTION'
          ].join('\n')
        );
        expect(report).not.toContain('bug');
        expect(report).not.toContain('parser');
      });
    });
  });

  describe('formatReplyReport', () => {
    describe('when there are no counts', () => {
      let results;

      beforeEach(() => {
        results = [formatReplyReport({}, MESSAGES), formatReplyReport(undefined, MESSAGES)];
      });

      it('should return null', () => {
        expect(results).toEqual([null, null]);
      });
    });

    describe('when counts tie and differ', () => {
      let report;

      beforeEach(() => {
        report = formatReplyReport(
          {
            'B|b': { check: 'B', match: 'b', message: 'mb', count: 1 },
            'A|a': { check: 'A', match: 'a', message: 'ma', count: 1 },
            'C|c': { check: 'C', match: 'c', message: 'mc', count: 3 }
          },
          MESSAGES
        );
      });

      it('should sort by count, then key, and wrap in intro and instruction', () => {
        expect(report).toBe(['INTRO', '  - C "c" (3): mc', '  - A "a" (1): ma', '  - B "b" (1): mb', 'INSTRUCTION'].join('\n'));
      });
    });

    describe('when more than ten rules were broken', () => {
      let lines;

      beforeEach(() => {
        const counts = {};
        for (let i = 0; i < 12; i++) counts[`R${i}|m`] = { check: `R${i}`, match: 'm', message: 'x', count: 1 };
        lines = formatReplyReport(counts, MESSAGES).split('\n');
      });

      it('should show ten and say how many were left out', () => {
        expect({ count: lines.length, more: lines[11], last: lines[12] }).toEqual({
          count: 13,
          more: '  (and 2 more)',
          last: 'INSTRUCTION'
        });
      });
    });
  });
});
