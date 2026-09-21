import { describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import { readStdinJson, emit, runHook } from './io.js';

/*
 * Branch map — src/lib/io.js
 *   readStdinJson: accumulates chunks, parses JSON
 *   emit: serializes to the stream
 *   runHook: main resolves · main rejects → swallowed
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
        try {
          await runHook(async () => {
            throw new Error('E_SOGGY_STROMBOLI');
          });
        } catch (e) {
          error = e;
        }
      });

      it('should swallow the rejection', () => {
        expect(error).toBe(undefined);
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
