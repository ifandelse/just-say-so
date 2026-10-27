import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventsFile, eventsOn, logEvent, readEvents, summarizeAlerts, fixedTerm } from './events.js';

/*
 * Branch map — src/lib/events.js
 *   eventsFile: under stateDir
 *   eventsOn: missing section → on · "on" → on · "off" → off
 *   logEvent: off → false, nothing written · on → directory created, one line
 *     with t/e/session/project/v first and the fields after · session and
 *     project missing → null · append fails (path is a directory) → false, no throw
 *   readEvents: missing file → [] · blank and damaged lines skipped
 *   fixedTerm: shipped word, phrase, contextual term → canonical spelling,
 *     through case, curly apostrophe, nbsp and hyphen variants · anything
 *     else → null (a frame capture, a short foreign-style match, empty)
 *   summarizeAlerts: null/undefined → null · [] → [] · counts per rule and
 *     severity · fixed-term match kept canonical · other match omitted ·
 *     overlap deduped · sorted by check, severity, match
 */

function tmpEnv() {
  return { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-events-')) };
}

function alert(over = {}) {
  return {
    Check: 'JustSaySo.Buzzwords',
    Severity: 'error',
    Line: 1,
    Span: [1, 7],
    Match: 'Synergy',
    Message: "Banned buzzword: 'synergy'.",
    ...over
  };
}

describe('events', () => {
  describe('eventsFile', () => {
    let result, env;

    beforeEach(() => {
      env = tmpEnv();
      result = eventsFile(env);
    });

    it('should sit in the state directory', () => {
      expect(result).toBe(path.join(env.JUST_SAY_SO_STATE_DIR, 'events.jsonl'));
    });
  });

  describe('eventsOn', () => {
    let missing, on, off;

    beforeEach(() => {
      missing = eventsOn({});
      on = eventsOn({ events: { mode: 'on' } });
      off = eventsOn({ events: { mode: 'off' } });
    });

    it('should be on unless the mode is off', () => {
      expect({ missing, on, off }).toEqual({ missing: true, on: true, off: false });
    });
  });

  describe('logEvent', () => {
    describe('when the log is on', () => {
      let written, lines;

      beforeEach(() => {
        const env = tmpEnv();
        const now = new Date('2026-10-26T14:02:11.410Z');
        written = logEvent(
          'reply',
          { session: 'S1', project: '/work/app', promptIndex: 7, outcome: 'pass' },
          { config: {}, env, now }
        );
        lines = fs.readFileSync(eventsFile(env), 'utf8').split('\n');
      });

      it('should append one line with the common fields first', () => {
        expect({ written, lines }).toEqual({
          written: true,
          lines: [
            `{"t":"2026-10-26T14:02:11.410Z","e":"reply","session":"S1","project":"/work/app","v":"${JSON.parse(fs.readFileSync('.claude-plugin/plugin.json', 'utf8')).version}","promptIndex":7,"outcome":"pass"}`,
            ''
          ]
        });
      });
    });

    describe('when session and project are missing', () => {
      let record;

      beforeEach(() => {
        const env = tmpEnv();
        logEvent('allow', { term: 'ninja' }, { config: {}, env });
        record = readEvents(eventsFile(env))[0];
      });

      it('should write them as null', () => {
        expect(record).toEqual({ t: expect.any(String), e: 'allow', session: null, project: null, v: expect.any(String), term: 'ninja' });
      });
    });

    describe('when the events path cannot be appended to', () => {
      let written, threw;

      beforeEach(() => {
        const env = tmpEnv();
        fs.mkdirSync(eventsFile(env), { recursive: true });
        try {
          written = logEvent('reply', { session: 'S1' }, { config: {}, env });
          threw = false;
        } catch {
          threw = true;
        }
      });

      it('should return false without throwing', () => {
        expect({ written, threw }).toEqual({ written: false, threw: false });
      });
    });

    describe('when the log is off', () => {
      let written, exists;

      beforeEach(() => {
        const env = tmpEnv();
        written = logEvent('reply', { session: 'S1' }, { config: { events: { mode: 'off' } }, env });
        exists = fs.existsSync(eventsFile(env));
      });

      it('should write nothing', () => {
        expect({ written, exists }).toEqual({ written: false, exists: false });
      });
    });
  });

  describe('readEvents', () => {
    let records, missing;

    beforeEach(() => {
      const env = tmpEnv();
      logEvent('session', { session: 'a' }, { config: {}, env });
      fs.appendFileSync(eventsFile(env), '\nnot json\n');
      logEvent('reply', { session: 'b' }, { config: {}, env });
      records = readEvents(eventsFile(env));
      missing = readEvents(path.join(env.JUST_SAY_SO_STATE_DIR, 'nope.jsonl'));
    });

    it('should return the parsable lines in order and [] for a missing file', () => {
      expect({ types: records.map((r) => [r.e, r.session]), missing }).toEqual({
        types: [
          ['session', 'a'],
          ['reply', 'b']
        ],
        missing: []
      });
    });
  });

  describe('fixedTerm', () => {
    let result;

    beforeEach(() => {
      result = {
        word: fixedTerm('Synergy'),
        hyphenated: fixedTerm('Cutting Edge'),
        phrase: fixedTerm('In\u00A0Order-to'),
        curly: fixedTerm('it\u2019s important to note'),
        contextual: fixedTerm('VERY'),
        frame: fixedTerm("it's not acme\u2014it's"),
        foreign: fixedTerm('ninja'),
        empty: fixedTerm(''),
        missing: fixedTerm(undefined)
      };
    });

    it('should return the canonical shipped term and nothing else', () => {
      expect(result).toEqual({
        word: 'synergy',
        hyphenated: 'cutting-edge',
        phrase: 'in order to',
        curly: "it's important to note",
        contextual: 'very',
        frame: null,
        foreign: null,
        empty: null,
        missing: null
      });
    });
  });

  describe('summarizeAlerts', () => {
    describe('when the reply was not linted', () => {
      let nul, undef;

      beforeEach(() => {
        nul = summarizeAlerts(null);
        undef = summarizeAlerts(undefined);
      });

      it('should pass null through', () => {
        expect({ nul, undef }).toEqual({ nul: null, undef: null });
      });
    });

    describe('when alerts of several shapes are folded', () => {
      let result;

      beforeEach(() => {
        result = summarizeAlerts([
          alert(),
          alert({ Line: 3, Match: 'synergy' }),
          // the same span flagged by a second style counts once
          alert({ Check: 'AITells.Buzzwords', Message: 'also synergy' }),
          alert({ Check: 'AITells.MicDrop', Severity: 'warning', Line: 5, Span: [1, 40], Match: 'This changes everything, full stop.' }),
          alert({ Check: 'AITells.MicDrop', Severity: 'warning', Line: 6, Span: [1, 20], Match: 'And that is the point.' }),
          alert({ Check: 'JustSaySo.Buzzwords', Line: 9, Span: [1, 8], Match: 'leverage' }),
          // the shipped frame rule captures reply text inside a short span
          alert({ Check: 'JustSaySo.NegativeParallelism', Line: 11, Span: [1, 18], Match: "It's not Acme\u2014it's" }),
          // a project style can capture any short text
          alert({ Check: 'Acme.Codenames', Severity: 'warning', Line: 12, Span: [1, 5], Match: 'Zeus' })
        ]);
      });

      it('should count per rule and severity, naming only shipped terms, sorted', () => {
        expect(result).toEqual([
          { check: 'Acme.Codenames', severity: 'warning', n: 1 },
          { check: 'AITells.MicDrop', severity: 'warning', n: 2 },
          { check: 'JustSaySo.Buzzwords', severity: 'error', n: 1, match: 'leverage' },
          { check: 'JustSaySo.Buzzwords', severity: 'error', n: 2, match: 'synergy' },
          { check: 'JustSaySo.NegativeParallelism', severity: 'error', n: 1 }
        ]);
      });
    });

    describe('when there are no alerts', () => {
      let result;

      beforeEach(() => {
        result = summarizeAlerts([]);
      });

      it('should return an empty list', () => {
        expect(result).toEqual([]);
      });
    });
  });
});
