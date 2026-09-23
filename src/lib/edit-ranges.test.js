import { describe, it, expect, beforeEach } from 'vitest';
import { findRanges, addedRanges, inRanges } from './edit-ranges.js';

const CONTENT = 'alpha\nbravo\ncharlie\nbravo\ndelta\n';

describe('edit-ranges', () => {
  describe('findRanges', () => {
    describe('when the needle appears more than once', () => {
      let result;

      beforeEach(() => {
        result = findRanges(CONTENT, 'bravo');
      });

      it('should return one range per occurrence', () => {
        expect(result).toEqual([
          [2, 2],
          [4, 4]
        ]);
      });
    });

    describe('when the needle spans lines', () => {
      let result;

      beforeEach(() => {
        result = findRanges(CONTENT, 'charlie\nbravo');
      });

      it('should return the full line span', () => {
        expect(result).toEqual([[3, 4]]);
      });
    });

    describe('when the needle is absent', () => {
      let result;

      beforeEach(() => {
        result = findRanges(CONTENT, 'zulu');
      });

      it('should return no ranges', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when the needle is empty', () => {
      let result;

      beforeEach(() => {
        result = findRanges(CONTENT, '');
      });

      it('should return no ranges', () => {
        expect(result).toEqual([]);
      });
    });
  });

  describe('addedRanges', () => {
    describe('when an Edit added text the file still contains', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('Edit', { old_string: 'x', new_string: 'charlie' }, CONTENT);
      });

      it('should return the located ranges', () => {
        expect(result).toEqual([[3, 3]]);
      });
    });

    describe('when an Edit only deleted text', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('Edit', { old_string: 'bravo', new_string: '' }, CONTENT);
      });

      it('should report no added lines', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when an Edit cannot be located in the file', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('Edit', { old_string: 'x', new_string: 'zulu' }, CONTENT);
      });

      it('should fall back to the whole file', () => {
        expect(result).toBeNull();
      });
    });

    describe('when a MultiEdit locates every edit', () => {
      let result;

      beforeEach(() => {
        result = addedRanges(
          'MultiEdit',
          {
            edits: [
              { old_string: 'x', new_string: 'alpha' },
              { old_string: 'y', new_string: 'delta' },
              { old_string: 'gone', new_string: '' }
            ]
          },
          CONTENT
        );
      });

      it('should union the located ranges and skip deletions', () => {
        expect(result).toEqual([
          [1, 1],
          [5, 5]
        ]);
      });
    });

    describe('when one MultiEdit entry cannot be located', () => {
      let result;

      beforeEach(() => {
        result = addedRanges(
          'MultiEdit',
          { edits: [{ old_string: 'x', new_string: 'alpha' }, { old_string: 'y', new_string: 'zulu' }] },
          CONTENT
        );
      });

      it('should fall back to the whole file', () => {
        expect(result).toBeNull();
      });
    });

    describe('when a MultiEdit carries no edits list', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('MultiEdit', {}, CONTENT);
      });

      it('should report no added lines', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when the tool is Write', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('Write', { content: CONTENT }, CONTENT);
      });

      it('should count the whole file', () => {
        expect(result).toBeNull();
      });
    });

    describe('when the tool is NotebookEdit', () => {
      let result;

      beforeEach(() => {
        result = addedRanges('NotebookEdit', { new_source: 'cells' }, CONTENT);
      });

      it('should count the whole file', () => {
        expect(result).toBeNull();
      });
    });
  });

  describe('inRanges', () => {
    let wholeFile, inside, outside;

    beforeEach(() => {
      wholeFile = inRanges(42, null);
      inside = inRanges(3, [[2, 4]]);
      outside = inRanges(9, [[2, 4]]);
    });

    it('should accept every line for a whole-file range and honor bounds otherwise', () => {
      expect([wholeFile, inside, outside]).toEqual([true, true, false]);
    });
  });
});
