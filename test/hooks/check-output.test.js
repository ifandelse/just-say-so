import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../src/lib/hooks/check-output.js';
import { readSession, writeSession } from '../../src/lib/state.js';
import { makeSandbox, writeTranscript } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-output.js
 *   mode off → null · stop_hook_active → null · no assistant text → null ·
 *   clean text → null · hard + block → decision block · hard + warn → null + note queued ·
 *   pending notes capped at 3 · missing session_id → "unknown" ·
 *   text source: last_assistant_message string preferred (transcript untouched) ·
 *   non-string or absent field → transcript fallback ·
 *   config anchor: event cwd finds no project config → recorded projectDir used ·
 *   no recorded projectDir either → defaults apply (off → null)
 */

const SESSION = 'OUTPUT_SESSION';

function bannedTranscript(sandbox) {
  return writeTranscript(sandbox.work, 'reply.jsonl', [
    { type: 'assistant', message: { id: 'MSG', content: [{ type: 'text', text: 'we leverage synergy' }] } }
  ]);
}

describe('check-output.run', () => {
  describe('when the check is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: bannedTranscript(sandbox) }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when our own rewrite request already fired', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, transcript_path: bannedTranscript(sandbox), stop_hook_active: true },
        sandbox.env
      );
    });

    it('should return null instead of looping', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the transcript has no assistant text', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: '/nope/missing.jsonl' }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the reply is clean', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      const transcript = writeTranscript(sandbox.work, 'reply.jsonl', [
        { type: 'assistant', message: { id: 'MSG', content: [{ type: 'text', text: 'The tests pass.' }] } }
      ]);
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: transcript }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the event carries last_assistant_message', () => {
    let banned, clean;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      const base = { session_id: SESSION, cwd: sandbox.work, transcript_path: '/nope/missing.jsonl' };
      banned = run({ ...base, last_assistant_message: 'we truly leverage synergy' }, sandbox.env);
      clean = run(
        { ...base, transcript_path: bannedTranscript(sandbox), last_assistant_message: 'The tests pass.' },
        sandbox.env
      );
    });

    it('should check that field and never read the transcript', () => {
      expect(banned.decision).toBe('block');
      expect(banned.reason).toContain('"leverage" ×1');
      expect(clean).toBe(null); // transcript has banned text; the field wins
    });
  });

  describe('when last_assistant_message is not a string', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          transcript_path: bannedTranscript(sandbox),
          last_assistant_message: { role: 'assistant', content: [] }
        },
        sandbox.env
      );
    });

    it('should fall back to the transcript', () => {
      expect(output.decision).toBe('block');
    });
  });

  describe('when block mode finds banned terms in the reply', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: bannedTranscript(sandbox) }, sandbox.env);
    });

    it('should block the stop with the violation list', () => {
      expect(output).toEqual({
        decision: 'block',
        reason:
          'just-say-so: your last reply contains banned terms:\n' +
          '  - "leverage" ×1 — use a concrete verb: use, apply, rely on\n' +
          '  - "synergy" ×1\n' +
          'Rewrite the reply per the communication rules.'
      });
    });
  });

  describe('when the event cwd finds no project config', () => {
    let withRecorded, withoutRecorded;

    beforeEach(() => {
      // Project config only — the sandbox global file is never written.
      const sandbox = makeSandbox();
      fs.writeFileSync(
        path.join(sandbox.work, '.just-say-so.json'),
        JSON.stringify({ outputCheck: { mode: 'block' } })
      );
      const event = {
        session_id: SESSION,
        cwd: '/nope/elsewhere', // a Stop event's cwd, seen live
        last_assistant_message: 'we leverage synergy'
      };
      writeSession(SESSION, { projectDir: sandbox.work }, sandbox.env);
      withRecorded = run(event, sandbox.env);

      const bare = makeSandbox();
      fs.writeFileSync(
        path.join(bare.work, '.just-say-so.json'),
        JSON.stringify({ outputCheck: { mode: 'block' } })
      );
      withoutRecorded = run(event, bare.env);
    });

    it('should fall back to the recorded project directory, and to defaults without one', () => {
      expect({
        withRecordedDecision: withRecorded?.decision,
        withoutRecorded
      }).toEqual({ withRecordedDecision: 'block', withoutRecorded: null });
    });
  });

  describe('when warn mode finds banned terms in the reply', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'warn' } });
      output = run({ cwd: sandbox.work, transcript_path: bannedTranscript(sandbox) }, sandbox.env); // no session_id
      state = readSession('unknown', sandbox.env);
    });

    it('should stay silent and queue one note for the next prompt', () => {
      expect({ output, noteCount: state.pendingNotes.length }).toEqual({ output: null, noteCount: 1 });
    });
  });

  describe('when warnings pile past the cap', () => {
    let state;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'warn' } });
      const transcript = bannedTranscript(sandbox);
      for (let i = 0; i < 5; i++) {
        run({ session_id: SESSION, cwd: sandbox.work, transcript_path: transcript }, sandbox.env);
      }
      state = readSession(SESSION, sandbox.env);
    });

    it('should keep only the newest three notes', () => {
      expect(state.pendingNotes).toHaveLength(3);
    });
  });
});
