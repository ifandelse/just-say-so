import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addAllowTerm, listFor } from './allow.js';
import { eventsFile, readEvents } from './events.js';

/*
 * Branch map — src/lib/allow.js
 *   listFor: single token → disableWords · whitespace → allowPhrases
 *   vocabTarget: .vale.ini with StylesPath+Vocab → accept.txt path ·
 *                missing either key → null (config route) ·
 *                unreadable ini → null (config route)
 *   addToVocabulary: new file → created · duplicate (case-insensitive) →
 *                added: false · append preserves existing lines
 *   addAllowTerm (config route): empty term → throw · no existing config →
 *                create in cwd · existing config found by walk-up → edit in
 *                place, keys preserved · duplicate → added: false ·
 *                malformed existing file → throw (never clobber)
 *   events: an allow event per call, session from CLAUDE_SESSION_ID or null,
 *           list null on the vocabulary route · events off → no file
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-allow-'));
}

function readConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Isolated state and an empty personal config, so the allow event never
// lands in the developer's own log.
function sandboxEnv(extra = {}) {
  const state = tmpdir();
  return { JUST_SAY_SO_STATE_DIR: state, JUST_SAY_SO_CONFIG: path.join(state, 'none.json'), ...extra };
}

describe('allow', () => {
  let env;

  beforeEach(() => {
    env = sandboxEnv();
  });

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
        result = addAllowTerm('robust', cwd, env);
      });

      it('should create .just-say-so.json in cwd with the term', () => {
        expect(result).toEqual({
          method: 'config',
          file: path.join(cwd, '.just-say-so.json'),
          list: 'disableWords',
          term: 'robust',
          added: true
        });
        expect(readConfig(result.file)).toEqual({ bannedCheck: { disableWords: ['robust'] } });
      });

      it('should log an allow event with no session', () => {
        expect(readEvents(eventsFile(env))).toEqual([
          { t: expect.any(String), e: 'allow', session: null, project: cwd, v: expect.any(String), term: 'robust', method: 'config', list: 'disableWords', added: true }
        ]);
      });
    });

    describe('when the harness exports a session id', () => {
      let events;

      beforeEach(() => {
        env = sandboxEnv({ CLAUDE_SESSION_ID: 'S-8675309' });
        addAllowTerm('robust', tmpdir(), env);
        events = readEvents(eventsFile(env));
      });

      it('should carry it on the event', () => {
        expect(events.map((e) => e.session)).toEqual(['S-8675309']);
      });
    });

    describe('when the events log is off', () => {
      let exists;

      beforeEach(() => {
        fs.writeFileSync(env.JUST_SAY_SO_CONFIG, JSON.stringify({ events: { mode: 'off' } }));
        addAllowTerm('robust', tmpdir(), env);
        exists = fs.existsSync(eventsFile(env));
      });

      it('should write no event', () => {
        expect(exists).toBe(false);
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
        result = addAllowTerm('robust regression', nested, env);
      });

      it('should edit that file in place and preserve the other settings', () => {
        expect(result).toEqual({ method: 'config', file, list: 'allowPhrases', term: 'robust regression', added: true });
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
        addAllowTerm('Robust', cwd, env);
        result = addAllowTerm('robust', cwd, env);
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
          addAllowTerm('robust', cwd, env);
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
          addAllowTerm('   ', tmpdir(), env);
        } catch (e) {
          error = e;
        }
      });

      it('should throw', () => {
        expect(error.message).toBe('no term given');
      });
    });

    describe('when a .vale.ini names StylesPath and Vocab', () => {
      let root, acceptFile, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nMinAlertLevel = suggestion\nVocab = Team\n');
        acceptFile = path.join(root, 'styles', 'config', 'vocabularies', 'Team', 'accept.txt');
        result = addAllowTerm('robust regression', root, env);
      });

      it('should create accept.txt with the term', () => {
        expect(result).toEqual({ method: 'vocabulary', file: acceptFile, term: 'robust regression', added: true });
        expect(fs.readFileSync(acceptFile, 'utf8')).toBe('robust regression\n');
      });

      it('should log the vocabulary route with no list', () => {
        expect(readEvents(eventsFile(env)).map(({ e, method, list, term }) => ({ e, method, list, term }))).toEqual([
          { e: 'allow', method: 'vocabulary', list: null, term: 'robust regression' }
        ]);
      });
    });

    describe('when the vocabulary already holds the term with different casing', () => {
      let acceptFile, result;

      beforeEach(() => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        acceptFile = path.join(root, 'styles', 'config', 'vocabularies', 'Team', 'accept.txt');
        fs.mkdirSync(path.dirname(acceptFile), { recursive: true });
        fs.writeFileSync(acceptFile, 'Robust Regression\nTLS\n');
        result = addAllowTerm('robust regression', root, env);
      });

      it('should report added: false and keep the file unchanged', () => {
        expect(result.added).toBe(false);
        expect(fs.readFileSync(acceptFile, 'utf8')).toBe('Robust Regression\nTLS\n');
      });
    });

    describe('when the vocabulary file exists and a new term arrives', () => {
      let acceptFile, result;

      beforeEach(() => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        acceptFile = path.join(root, 'styles', 'config', 'vocabularies', 'Team', 'accept.txt');
        fs.mkdirSync(path.dirname(acceptFile), { recursive: true });
        fs.writeFileSync(acceptFile, 'TLS\n');
        result = addAllowTerm('idempotent', root, env);
      });

      it('should append below the existing lines', () => {
        expect(result.added).toBe(true);
        expect(fs.readFileSync(acceptFile, 'utf8')).toBe('TLS\nidempotent\n');
      });
    });

    describe('when the .vale.ini names no Vocab', () => {
      let root, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\n');
        result = addAllowTerm('robust', root, env);
      });

      it('should fall back to the config route', () => {
        expect(result.method).toBe('config');
        expect(fs.existsSync(path.join(root, '.just-say-so.json'))).toBe(true);
      });
    });

    describe('when the .vale.ini cannot be read', () => {
      let result, spy;

      beforeEach(() => {
        const root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        const realRead = fs.readFileSync;
        spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
          if (String(file).endsWith('.vale.ini')) throw new Error('E_COLD_CALZONE');
          return realRead(file, ...rest);
        });
        result = addAllowTerm('robust', root, env);
      });

      afterEach(() => {
        spy.mockRestore();
      });

      it('should fall back to the config route', () => {
        expect(result.method).toBe('config');
      });
    });
  });
});
