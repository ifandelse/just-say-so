import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contextSize, lastAssistantText } from '../../src/lib/transcript.js';
import { writeTranscript } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/transcript.js
 *   parseLines: unreadable file → [] · blank line skipped · malformed line skipped
 *   contextSize: usage under message · usage at top level · missing cache fields → 0 ·
 *                usage without numeric input_tokens skipped · no usage anywhere → null
 *   textOf: content string · content array (non-text blocks filtered) · neither → ''
 *   lastAssistantText: no assistant → '' · assistant without message id → that entry only ·
 *                      assistant with id spanning several entries
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-transcript-'));
}

describe('transcript', () => {
  describe('contextSize', () => {
    describe('when the newest usage sits under message with cache fields', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'assistant', message: { usage: { input_tokens: 1, cache_read_input_tokens: 2 } } },
          '',
          '{malformed line',
          {
            type: 'assistant',
            message: {
              usage: { input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 }
            }
          }
        ]);
        result = contextSize(file);
      });

      it('should sum input and cache tokens of the newest entry, skipping junk lines', () => {
        expect(result).toBe(350);
      });
    });

    describe('when usage sits at the top level with cache fields missing', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [{ usage: { input_tokens: 90210 } }]);
        result = contextSize(file);
      });

      it('should treat missing cache fields as zero', () => {
        expect(result).toBe(90210);
      });
    });

    describe('when a newer usage block lacks numeric input_tokens', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'assistant', message: { usage: { input_tokens: 500 } } },
          { type: 'assistant', message: { usage: { input_tokens: 'E_COLD_CALZONE' } } }
        ]);
        result = contextSize(file);
      });

      it('should keep scanning back to the last valid one', () => {
        expect(result).toBe(500);
      });
    });

    describe('when no entry carries usage', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
        result = contextSize(file);
      });

      it('should return null', () => {
        expect(result).toBe(null);
      });
    });

    describe('when the transcript file is missing', () => {
      let result;

      beforeEach(() => {
        result = contextSize('/nope/missing.jsonl');
      });

      it('should return null instead of throwing', () => {
        expect(result).toBe(null);
      });
    });
  });

  describe('lastAssistantText', () => {
    describe('when the last assistant message spans several entries', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'assistant', message: { id: 'MSG_OLD', content: [{ type: 'text', text: 'stale reply' }] } },
          { type: 'user', message: { content: 'next question' } },
          {
            type: 'assistant',
            message: {
              id: 'MSG_NEW',
              content: [
                { type: 'text', text: 'we leverage synergy' },
                { type: 'tool_use', name: 'Write' }
              ]
            }
          },
          { type: 'assistant', message: { id: 'MSG_NEW', content: [{ type: 'text', text: 'second block' }] } }
        ]);
        result = lastAssistantText(file);
      });

      it('should join the text blocks of that message only, filtering non-text blocks', () => {
        expect(result).toBe('we leverage synergy\nsecond block');
      });
    });

    describe('when the last assistant entry has no message id and string content', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'assistant', message: { content: 'plain string reply' } }
        ]);
        result = lastAssistantText(file);
      });

      it('should return that entry alone', () => {
        expect(result).toBe('plain string reply');
      });
    });

    describe('when a message has content that is neither string nor array', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'assistant', message: { content: 8675309 } }
        ]);
        result = lastAssistantText(file);
      });

      it('should return empty text', () => {
        expect(result).toBe('');
      });
    });

    describe('when no assistant entry exists', () => {
      let missingFile, userOnly;

      beforeEach(() => {
        missingFile = lastAssistantText('/nope/missing.jsonl');
        const file = writeTranscript(tmpdir(), 't.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
        userOnly = lastAssistantText(file);
      });

      it('should return empty text', () => {
        expect({ missingFile, userOnly }).toEqual({ missingFile: '', userOnly: '' });
      });
    });
  });
});
