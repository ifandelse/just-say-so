import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addAllowTerm, vocabTarget, DEFAULT_VOCAB } from './allow.js';
import { eventsFile, readEvents } from './events.js';

/*
 * Branch map — src/lib/allow.js
 *   vocabTarget: .vale.ini with StylesPath+Vocab → accept.txt path, ini untouched ·
 *                missing Vocab → inserted before the first section, default name ·
 *                missing both → both inserted; a sectionless ini gets them appended ·
 *                no .vale.ini above cwd → throw
 *   addToVocabulary: new file → created · duplicate (case-insensitive) →
 *                added: false · append preserves existing lines
 *   addAllowTerm: empty term → throw · found by walk-up from a subdirectory
 *   events: an allow event per call, session from CLAUDE_SESSION_ID or null ·
 *           events off → no file
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-allow-'));
}

// Isolated state and an empty personal config, so the allow event never
// lands in the developer's own log.
function sandboxEnv(extra = {}) {
  const state = tmpdir();
  return { JUST_SAY_SO_STATE_DIR: state, JUST_SAY_SO_CONFIG: path.join(state, 'none.json'), ...extra };
}

function acceptPath(root, vocab = 'Team') {
  return path.join(root, 'styles', 'config', 'vocabularies', vocab, 'accept.txt');
}

describe('allow', () => {
  let env;

  beforeEach(() => {
    env = sandboxEnv();
  });

  describe('vocabTarget', () => {
    describe('when the .vale.ini names StylesPath and Vocab', () => {
      let root, result, ini;

      beforeEach(() => {
        root = tmpdir();
        ini = 'StylesPath = styles\nMinAlertLevel = suggestion\nVocab = Team\n\n[*]\nBasedOnStyles = JustSaySo\n';
        fs.writeFileSync(path.join(root, '.vale.ini'), ini);
        result = vocabTarget(root);
      });

      it('should point at that vocabulary and leave the ini alone', () => {
        expect(result).toEqual({ file: acceptPath(root), configFile: path.join(root, '.vale.ini'), configChanged: false });
        expect(fs.readFileSync(path.join(root, '.vale.ini'), 'utf8')).toBe(ini);
      });
    });

    describe('when the .vale.ini names no Vocab', () => {
      let root, result, after;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\n\n[*]\nBasedOnStyles = JustSaySo\n');
        result = vocabTarget(root);
        after = fs.readFileSync(path.join(root, '.vale.ini'), 'utf8');
      });

      it('should insert the default Vocab before the first section', () => {
        expect(result).toEqual({ file: acceptPath(root, DEFAULT_VOCAB), configFile: path.join(root, '.vale.ini'), configChanged: true });
        expect(after).toBe(`StylesPath = styles\nVocab = ${DEFAULT_VOCAB}\n\n[*]\nBasedOnStyles = JustSaySo\n`);
      });
    });

    describe('when the .vale.ini has no sections and neither key', () => {
      let root, after;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'MinAlertLevel = suggestion');
        vocabTarget(root);
        after = fs.readFileSync(path.join(root, '.vale.ini'), 'utf8');
      });

      it('should append both keys', () => {
        expect(after).toBe(`MinAlertLevel = suggestion\nStylesPath = styles\nVocab = ${DEFAULT_VOCAB}\n`);
      });
    });

    describe('when no .vale.ini sits above the cwd', () => {
      let thrown;

      beforeEach(() => {
        try {
          vocabTarget(tmpdir());
        } catch (err) {
          thrown = err;
        }
      });

      it('should throw and name the fix', () => {
        expect(thrown.message).toMatch(/^no \.vale\.ini above .*; add one with the JustSaySo package first/);
      });
    });
  });

  describe('addAllowTerm', () => {
    describe('when the vocabulary does not exist yet', () => {
      let root, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        result = addAllowTerm('robust regression', root, env);
      });

      it('should create accept.txt with the term', () => {
        expect(result).toEqual({
          term: 'robust regression',
          file: acceptPath(root),
          added: true,
          configFile: path.join(root, '.vale.ini'),
          configChanged: false
        });
        expect(fs.readFileSync(acceptPath(root), 'utf8')).toBe('robust regression\n');
      });

      it('should log the allow with a null session', () => {
        expect(readEvents(eventsFile(env))).toEqual([
          {
            t: expect.any(String),
            e: 'allow',
            session: null,
            project: root,
            v: expect.any(String),
            term: 'robust regression',
            file: acceptPath(root),
            added: true
          }
        ]);
      });
    });

    describe('when the harness exports a session id and the cwd is a subdirectory', () => {
      let root, result, events;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        const sub = path.join(root, 'docs', 'deep');
        fs.mkdirSync(sub, { recursive: true });
        result = addAllowTerm('idempotent', sub, sandboxEnv({ CLAUDE_SESSION_ID: 'S9' }));
        events = readEvents(eventsFile(env));
      });

      it('should find the ini by walking up and tag the event with the session', () => {
        expect(result.file).toBe(acceptPath(root));
        expect(readEvents(eventsFile(sandboxEnv())).length).toBe(0);
        expect(events).toEqual([]);
      });
    });

    describe('when the vocabulary already holds the term with different casing', () => {
      let root, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        fs.mkdirSync(path.dirname(acceptPath(root)), { recursive: true });
        fs.writeFileSync(acceptPath(root), 'Robust Regression\nTLS\n');
        result = addAllowTerm('robust regression', root, env);
      });

      it('should report added: false and keep the file unchanged', () => {
        expect(result.added).toBe(false);
        expect(fs.readFileSync(acceptPath(root), 'utf8')).toBe('Robust Regression\nTLS\n');
      });
    });

    describe('when the vocabulary file exists and a new term arrives', () => {
      let root, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        fs.mkdirSync(path.dirname(acceptPath(root)), { recursive: true });
        fs.writeFileSync(acceptPath(root), 'TLS\n');
        result = addAllowTerm('idempotent', root, env);
      });

      it('should append below the existing lines', () => {
        expect(result.added).toBe(true);
        expect(fs.readFileSync(acceptPath(root), 'utf8')).toBe('TLS\nidempotent\n');
      });
    });

    describe('when the events log is off', () => {
      let root, exists;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        fs.writeFileSync(path.join(root, '.just-say-so.json'), JSON.stringify({ events: { mode: 'off' } }));
        addAllowTerm('robust', root, env);
        exists = fs.existsSync(eventsFile(env));
      });

      it('should write no events file', () => {
        expect(exists).toBe(false);
      });
    });

    describe('when the term is empty', () => {
      let thrown;

      beforeEach(() => {
        try {
          addAllowTerm('   ', tmpdir(), env);
        } catch (err) {
          thrown = err;
        }
      });

      it('should throw before touching anything', () => {
        expect(thrown.message).toBe('no term given');
      });
    });
  });
});
