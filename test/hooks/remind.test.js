import { describe, it, expect, beforeEach } from 'vitest';
import { run } from '../../src/lib/hooks/remind.js';
import { readSession, writeSession } from '../../src/lib/state.js';
import { makeSandbox, writeTranscript } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/remind.js
 *   prompts mode: count % n !== 0 → null · count % n === 0 → fire ·
 *                 invalid everyPrompts → fallback 5
 *   tokens mode: transcript unreadable (ctx null) → no fire · no baseline → set, no fire ·
 *                growth < threshold → no fire · growth ≥ threshold → fire + new baseline
 *   mode off: no fire, but pending notes still deliver
 *   output assembly: notes only · rules only · notes + rules joined
 *   session_id missing → "unknown"
 */

const SESSION = 'REMIND_SESSION';

function promptEvent(sandbox, extra = {}) {
  return { session_id: SESSION, cwd: sandbox.work, ...extra };
}

describe('remind.run', () => {
  describe('when prompts mode has not reached the interval', () => {
    let outputs, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      outputs = [1, 2, 3, 4].map(() => run(promptEvent(sandbox), sandbox.env));
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent while counting prompts', () => {
      expect({ outputs, promptCount: state.promptCount }).toEqual({
        outputs: [null, null, null, null],
        promptCount: 4
      });
    });
  });

  describe('when prompts mode reaches the interval', () => {
    let fifth, sixth;

    beforeEach(() => {
      const sandbox = makeSandbox();
      for (let i = 0; i < 4; i++) run(promptEvent(sandbox), sandbox.env);
      fifth = run(promptEvent(sandbox), sandbox.env);
      sixth = run(promptEvent(sandbox), sandbox.env);
    });

    it('should inject the condensed rules on the fifth prompt', () => {
      expect(fifth).toEqual({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: expect.stringContaining('## Communication rules — reminder')
        }
      });
    });

    it('should go quiet again on the sixth', () => {
      expect(sixth).toBe(null);
    });
  });

  describe('when everyPrompts is not a usable number', () => {
    let outputs;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { everyPrompts: 'E_COLD_CALZONE' } });
      outputs = [1, 2, 3, 4, 5].map(() => run(promptEvent(sandbox), sandbox.env));
    });

    it('should fall back to firing every 5 prompts', () => {
      expect(outputs.map((o) => o !== null)).toEqual([false, false, false, false, true]);
    });
  });

  describe('when tokens mode cannot read the transcript', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'tokens' } });
      output = run(promptEvent(sandbox, { transcript_path: '/nope/missing.jsonl' }), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and leave the baseline unset', () => {
      expect({ output, baseline: state.contextAtLastReminder }).toEqual({ output: null, baseline: null });
    });
  });

  describe('when tokens mode sees the session for the first time', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'tokens', everyTokens: 100 } });
      const transcript = writeTranscript(sandbox.work, 't1.jsonl', [
        { type: 'assistant', message: { usage: { input_tokens: 1000 } } }
      ]);
      output = run(promptEvent(sandbox, { transcript_path: transcript }), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should set the baseline without firing', () => {
      expect({ output, baseline: state.contextAtLastReminder }).toEqual({ output: null, baseline: 1000 });
    });
  });

  describe('when context growth stays under the threshold', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'tokens', everyTokens: 100 } });
      writeSession(SESSION, { promptCount: 1, contextAtLastReminder: 1000, pendingNotes: [] }, sandbox.env);
      const transcript = writeTranscript(sandbox.work, 't2.jsonl', [
        { type: 'assistant', message: { usage: { input_tokens: 1050 } } }
      ]);
      output = run(promptEvent(sandbox, { transcript_path: transcript }), sandbox.env);
    });

    it('should stay silent', () => {
      expect(output).toBe(null);
    });
  });

  describe('when context growth reaches the threshold', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'tokens', everyTokens: 100 } });
      writeSession(SESSION, { promptCount: 1, contextAtLastReminder: 1000, pendingNotes: [] }, sandbox.env);
      const transcript = writeTranscript(sandbox.work, 't3.jsonl', [
        { type: 'assistant', message: { usage: { input_tokens: 1200 } } }
      ]);
      output = run(promptEvent(sandbox, { transcript_path: transcript }), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should fire and move the baseline to the current size', () => {
      expect({
        fired: output.hookSpecificOutput.additionalContext.includes('## Communication rules — reminder'),
        baseline: state.contextAtLastReminder
      }).toEqual({ fired: true, baseline: 1200 });
    });
  });

  describe('when the reminder is off but notes are pending', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'off' } });
      writeSession('unknown', { promptCount: 0, contextAtLastReminder: null, pendingNotes: ['THE NOTE'] }, sandbox.env);
      output = run({ cwd: sandbox.work }, sandbox.env); // no session_id → "unknown"
      state = readSession('unknown', sandbox.env);
    });

    it('should deliver the notes alone and clear the queue', () => {
      expect({ output, pendingNotes: state.pendingNotes }).toEqual({
        output: {
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'THE NOTE' }
        },
        pendingNotes: []
      });
    });
  });

  describe('when a reminder fires while notes are pending', () => {
    let context;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: null, pendingNotes: ['THE NOTE'] }, sandbox.env);
      context = run(promptEvent(sandbox), sandbox.env).hookSpecificOutput.additionalContext;
    });

    it('should lead with the notes and follow with the rules', () => {
      expect(context.startsWith('THE NOTE\n\n## Communication rules — reminder')).toBe(true);
    });
  });
});
