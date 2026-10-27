import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lastAssistantText, lastExchange } from './transcript.js';
import { writeTranscript } from '../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/transcript.js
 *   parseLines: unreadable file → [] · blank line skipped · malformed line skipped
 *   textOf: content string · content array (non-text blocks filtered) · neither → ''
 *   lastAssistantText: no assistant → '' · assistant without message id → that entry only ·
 *                      assistant with id spanning several entries
 *   isPromptEntry: non-user → no · string content (empty → no) · array with a
 *                  tool_result → no · array of text blocks · content neither → no
 *   lastExchange: no assistant → nulls · model string present · model missing →
 *                 null · prompt skips tool results back past a multi-entry
 *                 message · no id → that entry · no prompt before → null
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-transcript-'));
}

describe('transcript', () => {
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

  describe('lastExchange', () => {
    describe('when the last message spans entries and tool results sit between it and the prompt', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'user', message: { content: 'older prompt' } },
          { type: 'assistant', message: { id: 'msg_0', model: 'claude-x', content: [{ type: 'text', text: 'older reply' }] } },
          { type: 'user', message: { content: [{ type: 'text', text: 'how do we ship?' }] } },
          { type: 'assistant', message: { id: 'msg_1', model: 'claude-fable-5-1', content: [{ type: 'tool_use', name: 'Bash' }] } },
          { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
          { type: 'assistant', message: { id: 'msg_1', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'We ship synergy.' }] } }
        ]);
        result = lastExchange(file);
      });

      it('should return the prompt, the joined text, and the model', () => {
        expect(result).toEqual({ prompt: 'how do we ship?', text: 'We ship synergy.', model: 'claude-fable-5-1' });
      });
    });

    describe('when the last assistant entry has no id, no model, and only junk before it', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [
          { type: 'user', message: { content: '' } },
          { type: 'user', message: { content: 8675309 } },
          { type: 'user', message: { content: [{ type: 'image' }] } },
          { type: 'assistant', message: { content: 'plain reply' } }
        ]);
        result = lastExchange(file);
      });

      it('should return that entry alone with null prompt and model', () => {
        expect(result).toEqual({ prompt: null, text: 'plain reply', model: null });
      });
    });

    describe('when no assistant entry exists', () => {
      let result;

      beforeEach(() => {
        const file = writeTranscript(tmpdir(), 't.jsonl', [{ type: 'user', message: { content: 'hi' } }]);
        result = lastExchange(file);
      });

      it('should return empty text and nulls', () => {
        expect(result).toEqual({ prompt: null, text: '', model: null });
      });
    });
  });
});
