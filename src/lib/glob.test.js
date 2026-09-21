import { describe, it, expect, beforeEach } from 'vitest';
import { globToRegExp, matchesGlob, matchesAny } from './glob.js';

/*
 * Branch map — src/lib/glob.js
 *   globToRegExp: "**" followed by "/" · "**" at end · single "*" · "?" · literal (escaped)
 *   matchesGlob: no slash → basename · slash + absolute match · slash + cwd-relative match
 *                · file outside cwd → no match · no cwd → no match
 *   matchesAny: some pattern matches · none matches / empty list
 */

const DEFAULT_EXCLUDE = ['**/package*.json', '**/*.lock', '**/node_modules/**', '**/*.min.*'];

describe('glob', () => {
  describe('globToRegExp', () => {
    describe('when the pattern uses "**/" and "*"', () => {
      let regex;

      beforeEach(() => {
        regex = globToRegExp('**/package*.json');
      });

      it('should match at any depth including the root', () => {
        expect(['/a/b/package.json', 'package-lock.json'].map((p) => regex.test(p))).toEqual([true, true]);
      });
    });

    describe('when the pattern ends with "**"', () => {
      let regex;

      beforeEach(() => {
        regex = globToRegExp('**/node_modules/**');
      });

      it('should match everything under the directory', () => {
        expect(regex.test('/x/node_modules/pkg/deep/file.js')).toBe(true);
      });
    });

    describe('when the pattern uses "?"', () => {
      let oneChar, twoChars;

      beforeEach(() => {
        const regex = globToRegExp('a?.md');
        oneChar = regex.test('a1.md');
        twoChars = regex.test('a12.md');
      });

      it('should match exactly one character', () => {
        expect({ oneChar, twoChars }).toEqual({ oneChar: true, twoChars: false });
      });
    });

    describe('when the pattern contains regex metacharacters', () => {
      let result;

      beforeEach(() => {
        result = globToRegExp('notes.(draft).md').test('notes.(draft).md');
      });

      it('should treat them as literals', () => {
        expect(result).toBe(true);
      });
    });
  });

  describe('matchesGlob', () => {
    describe('when the pattern has no slash', () => {
      let nested, wrongExtension;

      beforeEach(() => {
        nested = matchesGlob('/deep/nested/notes.md', '*.md');
        wrongExtension = matchesGlob('/deep/nested/notes.txt', '*.md');
      });

      it('should match against the basename anywhere', () => {
        expect({ nested, wrongExtension }).toEqual({ nested: true, wrongExtension: false });
      });
    });

    describe('when the pattern has a slash and matches the absolute path', () => {
      let result;

      beforeEach(() => {
        result = matchesGlob('/repo/a/c.md', '/repo/a/*.md');
      });

      it('should match', () => {
        expect(result).toBe(true);
      });
    });

    describe('when a single star would need to cross a separator', () => {
      let result;

      beforeEach(() => {
        result = matchesGlob('/repo/a/b/c.md', '/repo/a/*.md');
      });

      it('should not match', () => {
        expect(result).toBe(false);
      });
    });

    describe('when a relative pattern is checked with a cwd', () => {
      let inside, outsideDir, outsideCwd;

      beforeEach(() => {
        inside = matchesGlob('/repo/docs/notes.md', 'docs/**', '/repo');
        outsideDir = matchesGlob('/repo/src/notes.md', 'docs/**', '/repo');
        outsideCwd = matchesGlob('/elsewhere/docs/notes.md', 'docs/**', '/repo');
      });

      it('should match only files under cwd in the named directory', () => {
        expect({ inside, outsideDir, outsideCwd }).toEqual({
          inside: true,
          outsideDir: false,
          outsideCwd: false
        });
      });
    });

    describe('when a relative pattern is checked without a cwd', () => {
      let result;

      beforeEach(() => {
        result = matchesGlob('/repo/docs/notes.md', 'docs/**');
      });

      it('should not match', () => {
        expect(result).toBe(false);
      });
    });
  });

  describe('matchesAny', () => {
    describe('when the path hits one of the default exclude patterns', () => {
      let results;

      beforeEach(() => {
        results = [
          '/repo/package.json',
          '/repo/pkg/package-lock.json',
          '/repo/yarn.lock',
          '/repo/node_modules/x/index.js',
          '/repo/dist/app.min.js'
        ].map((p) => matchesAny(p, DEFAULT_EXCLUDE));
      });

      it('should match every excluded path', () => {
        expect(results).toEqual([true, true, true, true, true]);
      });
    });

    describe('when the path hits none of the patterns', () => {
      let normalFile, emptyList, missingList;

      beforeEach(() => {
        normalFile = matchesAny('/repo/src/index.js', DEFAULT_EXCLUDE);
        emptyList = matchesAny('/repo/src/index.js', []);
        missingList = matchesAny('/repo/src/index.js', undefined);
      });

      it('should not match', () => {
        expect({ normalFile, emptyList, missingList }).toEqual({
          normalFile: false,
          emptyList: false,
          missingList: false
        });
      });
    });
  });
});
