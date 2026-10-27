import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { shippedConfigPath } from './vale.js';
import {
  parseRestate,
  rejectionsFile,
  lintReply,
  newRecord,
  appendRecord,
  readRecords,
  completeRecord
} from './rejections.js';

/*
 * Branch map — src/lib/rejections.js
 *   parseRestate: bare command → reason null · with reason → trimmed reason ·
 *     surrounding whitespace ignored · other prompt → null · prefix of a longer
 *     command → null · missing prompt → null
 *   rejectionsFile: under stateDir
 *   lintReply: empty text → [] · vale broken → null · alerts of every level mapped
 *     and exemptions applied
 *   newRecord: shape, rewrite null, config fields copied, version read
 *   appendRecord/readRecords: creates the directory · one line per record ·
 *     damaged line skipped on read
 *   completeRecord: fills the matching id → true · unknown id → false, file
 *     unchanged · missing file → false · damaged line kept on disk
 */

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rej-')), 'rejections.jsonl');
}

const CONFIG = {
  files: { mode: 'warn' },
  publish: { mode: 'block', gh: true, mcp: ['mcp__jira__*'], artifact: false },
  reply: { mode: 'warn' },
  rules: { onViolation: true }
};
const SNAPSHOT = {
  files: { mode: 'warn' },
  publish: { mode: 'block', gh: true, mcp: 1, artifact: false },
  reply: { mode: 'warn' },
  rules: { onViolation: true }
};

function valeAlert(over = {}) {
  return {
    Check: 'JustSaySo.Buzzwords',
    Severity: 'error',
    Line: 1,
    Span: [4, 10],
    Match: 'synergy',
    Message: "Banned buzzword: 'synergy'.",
    ...over
  };
}

describe('rejections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseRestate', () => {
    describe('when each prompt shape is given', () => {
      let results;

      beforeEach(() => {
        results = {
          bare: parseRestate('/just-say-so:restate'),
          reason: parseRestate('/just-say-so:restate verbal shorthand'),
          padded: parseRestate('  /just-say-so:restate   too terse  \n'),
          multiline: parseRestate('/just-say-so:restate first line\nsecond line'),
          other: parseRestate('please restate that'),
          longer: parseRestate('/just-say-so:restated'),
          otherSkill: parseRestate('/just-say-so:remind'),
          missing: parseRestate(undefined)
        };
      });

      it('should recognize only the restate command and keep the reason verbatim', () => {
        expect(results).toEqual({
          bare: { reason: null },
          reason: { reason: 'verbal shorthand' },
          padded: { reason: 'too terse' },
          multiline: { reason: 'first line\nsecond line' },
          other: null,
          longer: null,
          otherSkill: null,
          missing: null
        });
      });
    });
  });

  describe('rejectionsFile', () => {
    let file;

    beforeEach(() => {
      file = rejectionsFile({ JUST_SAY_SO_STATE_DIR: '/tmp/jss-state' });
    });

    it('should live under the state directory', () => {
      expect(file).toBe('/tmp/jss-state/rejections.jsonl');
    });
  });

  describe('lintReply', () => {
    describe('when the text is empty', () => {
      let result;

      beforeEach(() => {
        result = { alerts: lintReply('', CONFIG, shippedConfigPath()), spawned: mockSpawnSync.mock.calls.length };
      });

      it('should return an empty list without spawning vale', () => {
        expect(result).toEqual({ alerts: [], spawned: 0 });
      });
    });

    describe('when vale is broken', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
        result = lintReply('we ship synergy', CONFIG, shippedConfigPath());
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when vale reports alerts at every level', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockImplementation((_cmd, args) => {
          if (args[0] === 'ls-dirs') return { status: 0, stdout: '' };
          const target = args[args.length - 1];
          const alerts = [
            valeAlert(),
            valeAlert({ Check: 'JustSaySo.Intensifiers', Severity: 'suggestion', Match: 'very', Message: "Empty intensifier: 'very'.", Span: [1, 4], Line: 2 }),
            valeAlert({ Check: 'JustSaySo.Buzzwords', Match: 'ninja', Line: 3, Span: [1, 5] })
          ];
          return { status: 1, stdout: JSON.stringify({ [target]: alerts }) };
        });
        result = lintReply('we ship synergy\nvery fast\nninja', CONFIG, shippedConfigPath());
      });

      it('should map every level', () => {
        expect(result).toEqual([
          { check: 'JustSaySo.Buzzwords', severity: 'error', line: 1, match: 'synergy', message: "Banned buzzword: 'synergy'." },
          { check: 'JustSaySo.Intensifiers', severity: 'suggestion', line: 2, match: 'very', message: "Empty intensifier: 'very'." },
          { check: 'JustSaySo.Buzzwords', severity: 'error', line: 3, match: 'ninja', message: "Banned buzzword: 'synergy'." }
        ]);
      });
    });
  });

  describe('newRecord', () => {
    let record;

    beforeEach(() => {
      record = newRecord({
        sessionId: 'S1',
        project: '/work/app',
        promptIndex: 41,
        reason: 'verbal shorthand',
        rejected: { text: 'old reply', alerts: [] },
        config: CONFIG,
        now: new Date('2026-10-22T14:03:11Z')
      });
    });

    it('should carry the fields the analysis needs, with the rewrite still open', () => {
      expect(record).toEqual({
        id: expect.stringMatching(/^2026-10-22T14:03:11\.000Z-[0-9a-f]{4}$/),
        session: 'S1',
        project: '/work/app',
        promptIndex: 41,
        sinceReminder: null,
        model: null,
        reason: 'verbal shorthand',
        prompt: null,
        rejected: { text: 'old reply', alerts: [] },
        rewrite: null,
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        config: SNAPSHOT
      });
    });
  });

  describe('appendRecord and readRecords', () => {
    let records, missing;

    beforeEach(() => {
      const file = tmpFile();
      appendRecord(file, { id: 'a', reason: null });
      appendRecord(file, { id: 'b', reason: 'x' });
      fs.appendFileSync(file, 'not json\n');
      records = readRecords(file);
      missing = readRecords(path.join(path.dirname(file), 'nope.jsonl'));
    });

    it('should create the directory and read back one record per good line', () => {
      expect(records).toEqual([
        { id: 'a', reason: null },
        { id: 'b', reason: 'x' }
      ]);
    });

    it('should read a missing file as empty', () => {
      expect(missing).toEqual([]);
    });
  });

  describe('completeRecord', () => {
    describe('when the id is present among other lines', () => {
      let updated, onDisk;

      beforeEach(() => {
        const file = tmpFile();
        appendRecord(file, { id: 'a', rewrite: null });
        fs.appendFileSync(file, '{broken\n');
        appendRecord(file, { id: 'b', rewrite: null });
        updated = completeRecord(file, 'b', { text: 'new', alerts: [] });
        onDisk = fs.readFileSync(file, 'utf8').split('\n');
      });

      it('should fill that record and leave every other line as it was', () => {
        expect({ updated, onDisk }).toEqual({
          updated: true,
          onDisk: ['{"id":"a","rewrite":null}', '{broken', '{"id":"b","rewrite":{"text":"new","alerts":[]}}', '']
        });
      });
    });

    describe('when the id is unknown', () => {
      let updated, before, after;

      beforeEach(() => {
        const file = tmpFile();
        appendRecord(file, { id: 'a', rewrite: null });
        before = fs.readFileSync(file, 'utf8');
        updated = completeRecord(file, 'zzz', { text: 'new', alerts: [] });
        after = fs.readFileSync(file, 'utf8');
      });

      it('should report false and leave the file untouched', () => {
        expect({ updated, same: before === after }).toEqual({ updated: false, same: true });
      });
    });

    describe('when the file does not exist', () => {
      let updated;

      beforeEach(() => {
        updated = completeRecord(path.join(os.tmpdir(), 'jss-none', 'rejections.jsonl'), 'a', {});
      });

      it('should report false', () => {
        expect(updated).toBe(false);
      });
    });
  });
});
