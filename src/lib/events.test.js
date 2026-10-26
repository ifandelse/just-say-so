import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventsFile, eventsOn, logEvent, readEvents, summarizeAlerts } from './events.js';

/*
 * Branch map — src/lib/events.js
 *   eventsFile: under stateDir
 *   eventsOn: missing section → on · "on" → on · "off" → off
 *   logEvent: off → false, nothing written · on → directory created, one line
 *     with t/e/session/project/v first and the fields after · session and
 *     project missing → null
 *   readEvents: missing file → [] · blank and damaged lines skipped
 *   summarizeAlerts: null/undefined → null · [] → [] · counts per rule and
 *     severity · short match kept lowercased · long match omitted · overlap
 *     deduped · sorted by check, severity, match
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
          alert({ Check: 'JustSaySo.Buzzwords', Line: 9, Span: [1, 8], Match: 'leverage' })
        ]);
      });

      it('should count per rule, severity, and short match, sorted', () => {
        expect(result).toEqual([
          { check: 'AITells.MicDrop', severity: 'warning', n: 2 },
          { check: 'JustSaySo.Buzzwords', severity: 'error', n: 1, match: 'leverage' },
          { check: 'JustSaySo.Buzzwords', severity: 'error', n: 2, match: 'synergy' }
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
