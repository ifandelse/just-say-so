import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './remind.js';
import { readSession, writeSession } from '../state.js';
import { rejectionsFile, readRecords } from '../rejections.js';
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
 *   restate: records the previous reply with the reason, its Vale alerts, and the
 *     prompt index · sets pendingRewrite · resets both interval baselines · consumes
 *     the waiting reply counts · emits nothing · bare command → reason null ·
 *     ordinary prompt → no record file
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

// Vale stand-in: flags "synergy" at error level in whatever file it is handed.
function valeFlagsSynergy() {
  mockSpawnSync.mockImplementation((_cmd, args, opts) => {
    if (args[0] === 'ls-dirs') return { status: 0, stdout: '' };
    const target = args[args.length - 1];
    const text = fs.readFileSync(path.resolve(opts?.cwd ?? '.', target), 'utf8');
    const at = text.indexOf('synergy');
    if (at === -1) return { status: 0, stdout: JSON.stringify({}) };
    const alert = { Check: 'JustSaySo.Buzzwords', Severity: 'error', Line: 1, Span: [at + 1, at + 7], Match: 'synergy', Message: "Banned buzzword: 'synergy'." };
    return { status: 1, stdout: JSON.stringify({ [target]: [alert] }) };
  });
}

function rejectedReplyTranscript(sandbox) {
  return writeTranscript(sandbox.work, 'restate.jsonl', [
    { type: 'user', message: { role: 'user', content: 'how do we ship?' } },
    { type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'We ship synergy.' }] } }
  ]);
}

describe('remind.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    valeFlagsSynergy();
  });

  describe('when the prompt is the restate command with a reason', () => {
    let output, state, records;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(
        SESSION,
        { promptCount: 40, promptAtLastReminder: 21, contextAtLastReminder: 900, replyAlerts: COUNTS },
        sandbox.env
      );
      const transcript = rejectedReplyTranscript(sandbox);
      output = run(
        promptEvent(sandbox, { prompt: '/just-say-so:restate verbal shorthand', transcript_path: transcript }),
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
      records = readRecords(rejectionsFile(sandbox.env));
    });

    it('should emit nothing and leave the rules to the skill', () => {
      expect(output).toBeNull();
    });

    it('should record the rejected reply verbatim with the reason and its alerts', () => {
      expect(records).toEqual([
        {
          id: expect.any(String),
          session: SESSION,
          project: expect.any(String),
          promptIndex: 41,
          reason: 'verbal shorthand',
          rejected: {
            text: 'We ship synergy.',
            alerts: [{ check: 'JustSaySo.Buzzwords', severity: 'error', line: 1, match: 'synergy', message: "Banned buzzword: 'synergy'." }]
          },
          rewrite: null,
          version: expect.any(String),
          reminder: { mode: 'prompts', everyPrompts: 20 },
          outputCheck: { mode: 'warn', deliver: 'next-prompt' }
        }
      ]);
    });

    it('should hold the record open, reset the interval, and consume the waiting counts', () => {
      expect({
        pendingRewrite: state.pendingRewrite,
        promptCount: state.promptCount,
        promptAtLastReminder: state.promptAtLastReminder,
        contextAtLastReminder: state.contextAtLastReminder,
        replyAlerts: state.replyAlerts
      }).toEqual({
        pendingRewrite: records[0].id,
        promptCount: 41,
        promptAtLastReminder: 41,
        contextAtLastReminder: null,
        replyAlerts: {}
      });
    });
  });

  describe('when the prompt is the bare restate command', () => {
    let records;

    beforeEach(() => {
      const sandbox = makeSandbox();
      const transcript = rejectedReplyTranscript(sandbox);
      run(promptEvent(sandbox, { prompt: '/just-say-so:restate', transcript_path: transcript }), sandbox.env);
      records = readRecords(rejectionsFile(sandbox.env));
    });

    it('should record a null reason', () => {
      expect(records.map((r) => r.reason)).toEqual([null]);
    });
  });

  describe('when an ordinary prompt mentions restating', () => {
    let exists, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      run(promptEvent(sandbox, { prompt: 'please restate that /just-say-so:remind' }), sandbox.env);
      exists = fs.existsSync(rejectionsFile(sandbox.env));
      state = readSession(SESSION, sandbox.env);
    });

    it('should record nothing', () => {
      expect({ exists, pendingRewrite: state.pendingRewrite }).toEqual({ exists: false, pendingRewrite: null });
    });
  });

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
