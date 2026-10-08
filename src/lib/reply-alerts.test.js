import { describe, it, expect, beforeEach } from 'vitest';
import { replyCheckMode, recordReplyAlerts, formatReplyReport } from './reply-alerts.js';

/*
 * Branch map — src/lib/reply-alerts.js
 *   replyCheckMode: off · block · warn with a schedule → warn · warn without
 *     one → idle · missing sections → off
 *   recordReplyAlerts: new key · repeated key increments · null counts ·
 *     long match truncated · missing message → ""
 *   formatReplyReport: empty → null · sorted by count then key · capped at
 *     10 with a "more" line · instruction last
 */

const MESSAGES = {
  replyReportIntro: 'INTRO',
  replyReportMore: '(and {n} more)',
  replyReportInstruction: 'INSTRUCTION'
};

function alert(over = {}) {
  return { Check: 'JustSaySo.Buzzwords', Match: 'synergy', Message: "Banned buzzword: 'synergy'.", ...over };
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

  describe('recordReplyAlerts', () => {
    describe('when alerts repeat a key and add a new one', () => {
      let counts;

      beforeEach(() => {
        const first = recordReplyAlerts(null, [alert(), alert({ Match: 'Synergy' })]);
        counts = recordReplyAlerts(first, [alert({ Check: 'ai-tells.EmDash', Match: '—', Message: undefined })]);
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

    describe('when the match is long', () => {
      let counts;

      beforeEach(() => {
        counts = recordReplyAlerts({}, [alert({ Match: 'x'.repeat(80) })]);
      });

      it('should truncate the stored match', () => {
        expect(Object.values(counts)[0].match).toHaveLength(48);
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
