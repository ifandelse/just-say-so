import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStdinJson, emit, runHook, hookErrorsFile, readHookErrors } from './io.js';

/*
 * Branch map — src/lib/io.js
 *   readStdinJson: accumulates chunks, parses JSON
 *   emit: serializes to the stream
 *   runHook: main resolves · main rejects → exits clean, one stderr line,
 *     one JSON line in hook-errors.jsonl · readHookErrors: since filter,
 *     torn line skipped, missing file → []
 */

describe('io', () => {
  describe('readStdinJson', () => {
    describe('when the stream delivers JSON in chunks', () => {
      let result;

      beforeEach(async () => {
        result = await readStdinJson(Readable.from(['{"name":"Cal ', 'Zone","id":8675309}']));
      });

      it('should assemble and parse the full object', () => {
        expect(result).toEqual({ name: 'Cal Zone', id: 8675309 });
      });
    });
  });

  describe('emit', () => {
    describe('when given an object and a stream', () => {
      let written;

      beforeEach(() => {
        written = [];
        emit({ ok: true }, { write: (s) => written.push(s) });
      });

      it('should write the serialized JSON once', () => {
        expect(written).toEqual(['{"ok":true}']);
      });
    });
  });

  describe('runHook', () => {
    describe('when the main function rejects', () => {
      let error;

      beforeEach(async () => {
        // A sandbox state directory and a muted stderr: this must never
        // write into the developer's real state.
        const env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-io-')) };
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
          await runHook(async () => {
            throw new Error('E_SOGGY_STROMBOLI');
          }, { env });
        } catch (e) {
          error = e;
        }
        spy.mockRestore();
      });

      it('should swallow the rejection', () => {
        expect(error).toBe(undefined);
      });
    });

    describe('when the main function rejects with a state directory in hand', () => {
      let env, written, read, stderrLines;

      beforeEach(async () => {
        env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-io-')) };
        stderrLines = [];
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
          stderrLines.push(String(s));
          return true;
        });
        await runHook(async () => {
          throw new Error('E_WET_PRETZEL');
        }, { name: 'remind.js', env, now: new Date('2026-10-28T10:00:00Z') });
        spy.mockRestore();
        written = fs.readFileSync(hookErrorsFile(env), 'utf8');
        read = readHookErrors(env, '2026-10-28T00:00:00Z');
      });

      it('should write one stderr line and one JSON line, and read it back', () => {
        expect(stderrLines).toEqual(['just-say-so: remind.js failed: E_WET_PRETZEL\n']);
        expect(written.split('\n').filter(Boolean)).toHaveLength(1);
        expect(read).toEqual([{ t: '2026-10-28T10:00:00.000Z', hook: 'remind.js', message: 'E_WET_PRETZEL', stack: expect.stringContaining('E_WET_PRETZEL') }]);
        expect(readHookErrors(env, '2026-10-29T00:00:00Z')).toEqual([]);
        expect(readHookErrors({ JUST_SAY_SO_STATE_DIR: path.join(env.JUST_SAY_SO_STATE_DIR, 'nope') })).toEqual([]);
      });
    });

    describe('when the main function resolves', () => {
      let calls;

      beforeEach(async () => {
        calls = 0;
        await runHook(async () => {
          calls += 1;
        });
      });

      it('should run it exactly once', () => {
        expect(calls).toBe(1);
      });
    });
  });
});
