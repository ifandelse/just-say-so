import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addAllowTerm, vocabTarget, formatAllow, reportingRules, DEFAULT_VOCAB } from './allow.js';
import { makeSandbox, withFakeVale } from '../../test/helpers/sandbox.js';
import { eventsFile, readEvents } from './events.js';

/*
 * Branch map — src/lib/allow.js
 *   vocabTarget: .vale.ini with StylesPath+Vocab → accept.txt path, ini untouched ·
 *                missing Vocab → inserted before the first section, default name ·
 *                missing both → both inserted; a sectionless ini gets them appended ·
 *                an empty Vocab line is replaced in place · an absolute StylesPath is kept ·
 *                no .vale.ini above cwd → throw
 *   addToVocabulary: new file → created · exact duplicate → added: false ·
 *                a different casing is a new entry (Vale matches exactly) ·
 *                append preserves existing lines
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

    describe('when the .vale.ini has an empty Vocab line and an absolute StylesPath', () => {
      let root, styles, result, after;

      beforeEach(() => {
        root = tmpdir();
        styles = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = ${styles}\nVocab =\n\n[*]\nBasedOnStyles = X\n`);
        result = vocabTarget(root);
        after = fs.readFileSync(path.join(root, '.vale.ini'), 'utf8');
      });

      it('should replace the empty line and point at the absolute styles directory', () => {
        expect(result).toEqual({
          file: path.join(styles, 'config', 'vocabularies', DEFAULT_VOCAB, 'accept.txt'),
          configFile: path.join(root, '.vale.ini'),
          configChanged: true
        });
        expect(after).toBe(`StylesPath = ${styles}\nVocab = ${DEFAULT_VOCAB}\n\n[*]\nBasedOnStyles = X\n`);
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
          present: false,
          written: true,
          honoured: null,
          unreachable: null,
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
            added: true,
            unreachable: null
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

      it('should add the new spelling, because Vale matches entries exactly', () => {
        expect(result.added).toBe(true);
        expect(fs.readFileSync(acceptPath(root), 'utf8')).toBe('Robust Regression\nTLS\nrobust regression\n');
      });
    });

    describe('when the vocabulary already holds the exact term', () => {
      let root, result;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n');
        fs.mkdirSync(path.dirname(acceptPath(root)), { recursive: true });
        fs.writeFileSync(acceptPath(root), 'robust regression\nTLS\n');
        result = addAllowTerm('robust regression', root, env);
      });

      it('should report added: false and keep the file unchanged', () => {
        expect(result.added).toBe(false);
        expect(fs.readFileSync(acceptPath(root), 'utf8')).toBe('robust regression\nTLS\n');
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
  describe('reportingRules and the nonword gap', () => {
    // A fake vale that flags "synergy" (JustSaySo.Buzzwords, a word rule) and
    // "armed" (acme.Armed, a nonword rule), with ls-config pointing at a
    // styles directory that declares both.
    function fakeProject() {
      const sandbox = withFakeVale(makeSandbox());
      const root = fs.realpathSync(sandbox.work);
      const styles = path.join(root, 'styles');
      fs.mkdirSync(path.join(styles, 'JustSaySo'), { recursive: true });
      fs.mkdirSync(path.join(styles, 'acme'), { recursive: true });
      fs.writeFileSync(path.join(styles, 'JustSaySo', 'Buzzwords.yml'), 'extends: existence\nlevel: error\n');
      fs.writeFileSync(path.join(styles, 'acme', 'Armed.yml'), 'extends: existence\nlevel: error\nnonword: true\n');
      fs.writeFileSync(path.join(root, '.vale.ini'), 'StylesPath = styles\nVocab = Team\n[*]\nBasedOnStyles = JustSaySo, acme\n');
      const lsConfig = path.join(root, 'ls-config.json');
      fs.writeFileSync(lsConfig, JSON.stringify({ Formats: {}, GBaseStyles: ['JustSaySo', 'acme'], GChecks: {}, SBaseStyles: {}, SChecks: {}, RuleToLevel: {}, SLevels: {}, Paths: [styles], ConfigFiles: [] }));
      return { root, env: { ...sandbox.env, JUST_SAY_SO_CONFIG: path.join(root, 'none.json'), JSS_FAKE_LS_CONFIG: lsConfig } };
    }

    describe('when only a word rule reports the term', () => {
      let p, result, text;

      beforeEach(() => {
        p = fakeProject();
        result = addAllowTerm('synergy', p.root, p.env);
        text = formatAllow(result);
      });

      it('should write the entry and name the rule it silences', () => {
        expect({ written: result.written, added: result.added, honoured: result.honoured, unreachable: result.unreachable }).toEqual({
          written: true,
          added: true,
          honoured: ['JustSaySo.Buzzwords'],
          unreachable: []
        });
        expect(text).toBe(`just-say-so: added "synergy" to the Vale vocabulary (${acceptPath(p.root)})\njust-say-so: JustSaySo.Buzzwords no longer reports it (checked by linting the term again).\n`);
      });
    });

    describe('when only a nonword rule reports the term', () => {
      let p, result, text;

      beforeEach(() => {
        p = fakeProject();
        result = addAllowTerm('stays armed', p.root, p.env);
        text = formatAllow(result);
      });

      it('should write nothing and explain the two ways out', () => {
        expect({ written: result.written, added: result.added, honoured: result.honoured, kept: fs.existsSync(acceptPath(p.root)) && fs.readFileSync(acceptPath(p.root), 'utf8').includes('armed') }).toEqual({
          written: false,
          added: false,
          honoured: [],
          kept: false
        });
        expect(result.unreachable).toEqual([{ id: 'acme.Armed', message: "Enforcement metaphor: 'armed'. Say what the check refuses.", reason: 'nonword' }]);
        expect(text).toContain('"stays armed" is reported by acme.Armed.\n\nThat rule matches text across word boundaries, and Vale ignores the project\nvocabulary (accept.txt) for it.');
        expect(text).toContain('nothing for\nit, so the entry was not kept.');
        expect(text).toContain("  1. Rewrite the phrase.\n     acme.Armed: Enforcement metaphor: 'armed'. Say what the check refuses.");
        expect(text).toContain('       acme.Armed = NO\n');
      });
    });

    describe('when a word rule and a nonword rule both report the term', () => {
      let p, result, text;

      beforeEach(() => {
        p = fakeProject();
        result = addAllowTerm('synergy armed', p.root, p.env);
        text = formatAllow(result);
      });

      it('should write the entry for the word rule and explain the other', () => {
        expect({ written: result.written, honoured: result.honoured, unreachable: result.unreachable.map((r) => r.id) }).toEqual({
          written: true,
          honoured: ['JustSaySo.Buzzwords'],
          unreachable: ['acme.Armed']
        });
        expect(text).toContain('JustSaySo.Buzzwords no longer reports it (checked by linting the term again).\n\n"synergy armed" is still reported by acme.Armed.');
        expect(text).toContain('nothing for\nit.\n');
      });
    });

    describe('when a sequence rule reports the term, alone and beside a nonword rule', () => {
      let p, alone, both, texts;

      beforeEach(() => {
        p = fakeProject();
        fs.writeFileSync(path.join(p.root, 'styles', 'acme', 'Verbs.yml'), 'extends: sequence\nlevel: error\ntokens:\n  - pattern: navigate\n');
        alone = addAllowTerm('navigate the menu', p.root, p.env);
        both = addAllowTerm('navigate while armed', p.root, p.env);
        texts = [formatAllow(alone), formatAllow(both)];
      });

      it('should keep nothing, name the part-of-speech reason, and give the generic reason for a mixed pair', () => {
        expect({ written: alone.written, reasons: alone.unreachable.map((r) => r.reason), kept: fs.readFileSync(acceptPath(p.root), 'utf8').includes('navigate') }).toEqual({
          written: false,
          reasons: ['sequence'],
          kept: false
        });
        expect(texts[0]).toContain('That rule matches by part of speech, and Vale ignores the project\nvocabulary (accept.txt) for it.');
        expect(both.unreachable.map((r) => r.reason)).toEqual(['acme.Armed', 'acme.Verbs'].map((id) => (id === 'acme.Armed' ? 'nonword' : 'sequence')));
        expect(texts[1]).toContain('Each of those rules is one for which Vale ignores the project\nvocabulary (accept.txt) for it.');
        expect(texts[1]).toContain('       acme.Armed = NO\n       acme.Verbs = NO\n');
      });
    });

    describe('when the rule that still reports is neither nonword nor sequence', () => {
      let p, result, text;

      beforeEach(() => {
        p = fakeProject();
        fs.writeFileSync(path.join(p.root, 'styles', 'acme', 'Verbs.yml'), 'extends: existence\nlevel: error\ntokens:\n  - navigate\n');
        result = addAllowTerm('navigate the menu', p.root, p.env);
        text = formatAllow(result);
      });

      it('should give the generic reason', () => {
        expect(result.unreachable.map((r) => r.reason)).toEqual(['other']);
        expect(text).toContain('That rule is one for which Vale ignores the project\nvocabulary (accept.txt) for it.');
      });
    });

    describe('when the term ends in sentence punctuation', () => {
      let p, result;

      beforeEach(() => {
        p = fakeProject();
        result = addAllowTerm('pure synergy.', p.root, p.env);
      });

      it('should drop the punctuation and write the bare collocation', () => {
        expect({ term: result.term, line: fs.readFileSync(acceptPath(p.root), 'utf8') }).toEqual({ term: 'pure synergy', line: 'pure synergy\n' });
      });
    });

    describe('when no active rule reports the term, and when it is already accepted', () => {
      let p, first, second, texts;

      beforeEach(() => {
        p = fakeProject();
        first = addAllowTerm('idempotent', p.root, p.env);
        second = addAllowTerm('idempotent', p.root, p.env);
        texts = [formatAllow(first), formatAllow(second)];
      });

      it('should write it once and say that nothing reports it yet', () => {
        expect([first.added, second.added, first.honoured]).toEqual([true, false, []]);
        expect(texts[0]).toContain('no active rule reports the term on its own');
        expect(texts[1]).toMatch(/^just-say-so: "idempotent" is already in the Vale vocabulary/);
      });
    });

    describe('when vale cannot lint here, and when the ini gained its keys', () => {
      let p, result, text, rules;

      beforeEach(() => {
        p = fakeProject();
        fs.writeFileSync(path.join(p.root, '.vale.ini'), '[*]\nBasedOnStyles = JustSaySo\n');
        const env = { ...p.env, PATH: '' };
        rules = reportingRules('synergy', p.root, env);
        result = addAllowTerm('synergy', p.root, env);
        text = formatAllow(result);
      });

      it('should report null, write the entry, and say the reach is unknown', () => {
        expect({ rules, written: result.written, honoured: result.honoured, configChanged: result.configChanged }).toEqual({ rules: null, written: true, honoured: null, configChanged: true });
        expect(text).toContain(`just-say-so: added StylesPath/Vocab to ${path.join(p.root, '.vale.ini')}\njust-say-so: vale could not lint the term here`);
      });
    });

    describe('when ls-config works but the lint itself fails', () => {
      let p, rules;

      beforeEach(() => {
        p = fakeProject();
        // The fake exits 2 when it cannot read the target; a config that names
        // a directory as the target does that.
        const dir = path.join(p.root, 'styles');
        rules = reportingRules('synergy', dir, { ...p.env, JSS_FAKE_LINT_FAIL: '1' });
      });

      it('should report null', () => {
        expect(rules).toBeNull();
      });
    });
  });
});
