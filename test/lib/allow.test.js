import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addAllowTerm, listFor } from '../../src/lib/allow.js';

/*
 * Branch map — src/lib/allow.js
 *   listFor: single token → disableWords · whitespace → allowPhrases
 *   addAllowTerm: empty term → throw · no existing config → create in cwd ·
 *                 existing config found by walk-up → edit in place, keys preserved ·
 *                 duplicate (case-insensitive) → added: false, no dupe ·
 *                 malformed existing file → throw (never clobber)
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-allow-'));
}

function readConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('allow', () => {
  describe('listFor', () => {
    describe('when terms of both shapes are classified', () => {
      let word, phrase;

      beforeEach(() => {
        word = listFor('robust');
        phrase = listFor('robust regression');
      });

      it('should route single tokens to disableWords and collocations to allowPhrases', () => {
        expect({ word, phrase }).toEqual({ word: 'disableWords', phrase: 'allowPhrases' });
      });
    });
  });

  describe('addAllowTerm', () => {
    describe('when no project config exists', () => {
      let cwd, result;

      beforeEach(() => {
        cwd = tmpdir();
        result = addAllowTerm('robust', cwd);
      });

      it('should create .just-say-so.json in cwd with the term', () => {
        expect(result).toEqual({
          file: path.join(cwd, '.just-say-so.json'),
          list: 'disableWords',
          term: 'robust',
          added: true
        });
        expect(readConfig(result.file)).toEqual({ bannedCheck: { disableWords: ['robust'] } });
      });
    });

    describe('when a config exists above the cwd with other settings', () => {
      let file, result;

      beforeEach(() => {
        const root = tmpdir();
        file = path.join(root, '.just-say-so.json');
        fs.writeFileSync(file, JSON.stringify({ reminder: { mode: 'tokens' }, bannedCheck: { mode: 'warn' } }));
        const nested = path.join(root, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        result = addAllowTerm('robust regression', nested);
      });

      it('should edit that file in place and preserve the other settings', () => {
        expect(result).toEqual({ file, list: 'allowPhrases', term: 'robust regression', added: true });
        expect(readConfig(file)).toEqual({
          reminder: { mode: 'tokens' },
          bannedCheck: { mode: 'warn', allowPhrases: ['robust regression'] }
        });
      });
    });

    describe('when the term is already listed with different casing', () => {
      let cwd, result;

      beforeEach(() => {
        cwd = tmpdir();
        addAllowTerm('Robust', cwd);
        result = addAllowTerm('robust', cwd);
      });

      it('should report added: false and keep the list deduplicated', () => {
        expect(result.added).toBe(false);
        expect(readConfig(result.file).bannedCheck.disableWords).toEqual(['Robust']);
      });
    });

    describe('when the existing config file is malformed', () => {
      let cwd, error;

      beforeEach(() => {
        cwd = tmpdir();
        fs.writeFileSync(path.join(cwd, '.just-say-so.json'), '{oops');
        try {
          addAllowTerm('robust', cwd);
        } catch (e) {
          error = e;
        }
      });

      it('should throw instead of clobbering the file', () => {
        expect(error).toBeInstanceOf(SyntaxError);
        expect(fs.readFileSync(path.join(cwd, '.just-say-so.json'), 'utf8')).toBe('{oops');
      });
    });

    describe('when the term is empty', () => {
      let error;

      beforeEach(() => {
        try {
          addAllowTerm('   ', tmpdir());
        } catch (e) {
          error = e;
        }
      });

      it('should throw', () => {
        expect(error.message).toBe('no term given');
      });
    });
  });
});
