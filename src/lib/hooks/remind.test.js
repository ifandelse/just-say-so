import { describe, it, expect, beforeEach } from 'vitest';
import { run } from './remind.js';
import { readSession, writeSession } from '../state.js';
import { makeSandbox, writeTranscript } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/remind.js
 *   prompts mode: prompts since last fire < n → null · ≥ n → fire ·
 *                 invalid everyPrompts → the default interval
 *   tokens mode: transcript unreadable (ctx null) → no fire · no baseline → set, no fire ·
 *                growth < threshold → no fire · growth ≥ threshold → fire + new baseline
 *   mode off, next-reminder delivery: never fires, still counts prompts
 *   next-prompt delivery (the default): counts waiting → fire with the report, counts
 *     cleared, interval reset · no counts → silent until the default 20-prompt interval · outputCheck off → never fires on counts ·
 *     a counts-fire pushes the next interval fire back
 *   next-reminder delivery: counts wait for the interval · fire → rules then report, cleared
 *   session_id missing → "unknown"
 */

const COUNTS = { 'JustSaySo.Buzzwords|synergy': { check: 'JustSaySo.Buzzwords', match: 'synergy', message: "Banned buzzword: 'synergy'.", count: 2 } };

const SESSION = 'REMIND_SESSION';
const INTERVAL_ONLY = { reminder: { mode: 'prompts', everyPrompts: 5 }, outputCheck: { mode: 'warn', deliver: 'next-reminder' } };

function promptEvent(sandbox, extra = {}) {
  return { session_id: SESSION, cwd: sandbox.work, ...extra };
}

function fired(output) {
  return output?.hookSpecificOutput?.additionalContext?.includes('## Communication rules — reminder') ?? false;
}

describe('remind.run', () => {
  describe('when prompts mode has not reached the interval', () => {
    let outputs, state, work;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'prompts', everyPrompts: 5 } });
      work = sandbox.work;
      outputs = [1, 2, 3, 4].map(() => run(promptEvent(sandbox), sandbox.env));
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent while counting prompts', () => {
      expect({ outputs, promptCount: state.promptCount }).toEqual({
        outputs: [null, null, null, null],
        promptCount: 4
      });
    });

    it('should record the project directory for hooks whose events lack one', () => {
      expect(state.projectDir).toBe(work);
    });
  });

  describe('when prompts mode reaches the interval', () => {
    let fifth, sixth, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'prompts', everyPrompts: 5 } });
      for (let i = 0; i < 4; i++) run(promptEvent(sandbox), sandbox.env);
      fifth = run(promptEvent(sandbox), sandbox.env);
      state = readSession(SESSION, sandbox.env);
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

    it('should mark the prompt it fired on', () => {
      expect(state.promptAtLastReminder).toBe(5);
    });

    it('should go quiet again on the sixth', () => {
      expect(sixth).toBe(null);
    });
  });

  describe('when everyPrompts is not a usable number', () => {
    let outputs;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'prompts', everyPrompts: 'E_COLD_CALZONE' } });
      outputs = Array.from({ length: 20 }, () => run(promptEvent(sandbox), sandbox.env));
    });

    it('should fall back to the default interval of 20 prompts', () => {
      expect(outputs.map(fired)).toEqual([...Array(19).fill(false), true]);
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
      writeSession(SESSION, { promptCount: 1, contextAtLastReminder: 1000 }, sandbox.env);
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
      writeSession(SESSION, { promptCount: 1, contextAtLastReminder: 1000 }, sandbox.env);
      const transcript = writeTranscript(sandbox.work, 't3.jsonl', [
        { type: 'assistant', message: { usage: { input_tokens: 1200 } } }
      ]);
      output = run(promptEvent(sandbox, { transcript_path: transcript }), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should fire and move the baseline to the current size', () => {
      expect({ fired: fired(output), baseline: state.contextAtLastReminder }).toEqual({ fired: true, baseline: 1200 });
    });
  });

  describe('when the reminder is off and the report waits for a reminder', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'off' }, outputCheck: { mode: 'warn', deliver: 'next-reminder' } });
      writeSession('unknown', { promptCount: 4, replyAlerts: COUNTS }, sandbox.env);
      output = run({ cwd: sandbox.work }, sandbox.env); // no session_id → "unknown"
      state = readSession('unknown', sandbox.env);
    });

    it('should stay silent, count the prompt, and leave the reply counts alone', () => {
      expect({ output, promptCount: state.promptCount, replyAlerts: state.replyAlerts }).toEqual({
        output: null,
        promptCount: 5,
        replyAlerts: COUNTS
      });
    });
  });

  describe('when reply counts wait under the default config', () => {
    let context, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      context = run(promptEvent(sandbox), sandbox.env).hookSpecificOutput.additionalContext;
      state = readSession(SESSION, sandbox.env);
    });

    it('should fire on the next prompt with the rules and then the report', () => {
      expect(context).toMatch(/^## Communication rules — reminder[^]*\n\nRecent replies broke these rules[^]*"synergy" \(2\)/);
    });

    it('should clear the counts and mark the prompt it fired on', () => {
      expect({ replyAlerts: state.replyAlerts, at: state.promptAtLastReminder }).toEqual({ replyAlerts: {}, at: 2 });
    });
  });

  describe('when no reply counts wait under the default config', () => {
    let outputs;

    beforeEach(() => {
      const sandbox = makeSandbox();
      outputs = Array.from({ length: 21 }, () => run(promptEvent(sandbox), sandbox.env));
    });

    it('should stay silent until the twentieth prompt', () => {
      expect(outputs.map(fired)).toEqual([...Array(19).fill(false), true, false]);
    });
  });

  describe('when counts linger in state but the reply check is off', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'off' } });
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      output = run(promptEvent(sandbox), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and leave the counts alone', () => {
      expect({ output, replyAlerts: state.replyAlerts }).toEqual({ output: null, replyAlerts: COUNTS });
    });
  });

  describe('when a report fires one prompt before the interval would have', () => {
    let outputs;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'prompts', everyPrompts: 3 } });
      for (let i = 0; i < 2; i++) run(promptEvent(sandbox), sandbox.env);
      writeSession(SESSION, { ...readSession(SESSION, sandbox.env), replyAlerts: COUNTS }, sandbox.env);
      // Prompt 3: the report fires (the interval would have too). Prompts 4 and
      // 5 stay quiet; prompt 6 is three past the last fire.
      outputs = [3, 4, 5, 6].map(() => run(promptEvent(sandbox), sandbox.env));
    });

    it('should push the next interval fire back to three prompts after the report', () => {
      expect(outputs.map(fired)).toEqual([true, false, false, true]);
    });
  });

  describe('when a reminder fires while reply counts wait for it', () => {
    let context, state;

    beforeEach(() => {
      const sandbox = makeSandbox(INTERVAL_ONLY);
      writeSession(SESSION, { promptCount: 4, replyAlerts: COUNTS }, sandbox.env);
      context = run(promptEvent(sandbox), sandbox.env).hookSpecificOutput.additionalContext;
      state = readSession(SESSION, sandbox.env);
    });

    it('should lead with the rules and follow with the report', () => {
      expect(context).toMatch(/^## Communication rules — reminder[^]*\n\nRecent replies broke these rules[^]*"synergy" \(2\)/);
    });

    it('should clear the counts', () => {
      expect(state.replyAlerts).toEqual({});
    });
  });

  describe('when reply counts wait for a reminder whose interval has not come', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox(INTERVAL_ONLY);
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      output = run(promptEvent(sandbox), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and keep the counts', () => {
      expect({ output, replyAlerts: state.replyAlerts }).toEqual({ output: null, replyAlerts: COUNTS });
    });
  });
});
