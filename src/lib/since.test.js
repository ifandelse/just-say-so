import { describe, it, expect, beforeEach } from 'vitest';
import { parseSince } from './since.js';

/*
 * Branch map — src/lib/since.js
 *   parseSince: empty → null · a day span · a week span · an ISO date ·
 *     anything else throws
 */

const NOW = new Date('2026-10-01T12:00:00.000Z');

describe('since', () => {
  describe('parseSince', () => {
    describe('when no value is given', () => {
      let result;

      beforeEach(() => {
        result = parseSince('', NOW);
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when the value is a span in days', () => {
      let result;

      beforeEach(() => {
        result = parseSince('30d', NOW);
      });

      it('should count the days back from now', () => {
        expect(result).toBe('2026-09-01T12:00:00.000Z');
      });
    });

    describe('when the value is a span in weeks', () => {
      let result;

      beforeEach(() => {
        result = parseSince('2w', NOW);
      });

      it('should count seven days per week back from now', () => {
        expect(result).toBe('2026-09-17T12:00:00.000Z');
      });
    });

    describe('when the value is an ISO date', () => {
      let result;

      beforeEach(() => {
        result = parseSince('2026-09-15', NOW);
      });

      it('should return that instant as an ISO string', () => {
        expect(result).toBe('2026-09-15T00:00:00.000Z');
      });
    });

    describe('when the value is neither a span nor a date', () => {
      let error;

      beforeEach(() => {
        try {
          parseSince('last tuesday', NOW);
        } catch (e) {
          error = e;
        }
      });

      it('should throw naming the accepted forms', () => {
        expect(error.message).toBe('--since takes an ISO date or a span such as 30d or 6w, not last tuesday');
      });
    });
  });
});
