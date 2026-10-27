import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './remind.js';
import { readSession, writeSession } from '../state.js';
import { rejectionsFile, readRecords } from '../rejections.js';
import { eventsFile, readEvents } from '../events.js';
import { makeSandbox, writeTranscript } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/remind.js
 *   counts waiting + reply warn + onViolation (the default): fire with the
 *     rules then the report, counts cleared, injection marked · no counts →
 *     silent, prompts counted · reply off → never fires on counts ·
 *     onViolation off → counts kept for the next context start
 *   restate: records the previous reply with the reason, its Vale alerts, and the
 *     prompt index · sets pendingRewrite · marks the injection · consumes
 *     the waiting reply counts · emits nothing · bare command → reason null ·
 *     ordinary prompt → no record file
 *   session_id missing → "unknown"
 *   events: reminder event per fire with trigger report | restate and
 *     withReport · restate → restate event first
 */

function reminderEvents(env) {
  return readEvents(eventsFile(env))
    .filter((e) => e.e === 'reminder')
    .map(({ promptIndex, trigger, withReport }) => ({ promptIndex, trigger, withReport }));
}

const COUNTS = { 'JustSaySo.Buzzwords|synergy': { check: 'JustSaySo.Buzzwords', match: 'synergy', message: "Banned buzzword: 'synergy'.", count: 2 } };

const SESSION = 'REMIND_SESSION';

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
    let output, state, records, events;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(
        SESSION,
        { promptCount: 40, promptAtLastReminder: 21, replyAlerts: COUNTS },
        sandbox.env
      );
      const transcript = rejectedReplyTranscript(sandbox);
      output = run(
        promptEvent(sandbox, { prompt: '/just-say-so:restate verbal shorthand', transcript_path: transcript }),
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
      records = readRecords(rejectionsFile(sandbox.env));
      events = readEvents(eventsFile(sandbox.env));
    });

    it('should emit nothing and leave the rules to the skill', () => {
      expect(output).toBeNull();
    });

    it('should log the rejection and the rules going out through the skill', () => {
      expect(events).toEqual([
        {
          t: expect.any(String),
          e: 'restate',
          session: SESSION,
          project: expect.any(String),
          v: expect.any(String),
          promptIndex: 41,
          sinceReminder: 19,
          record: records[0].id,
          reasonGiven: true
        },
        {
          t: expect.any(String),
          e: 'reminder',
          session: SESSION,
          project: expect.any(String),
          v: expect.any(String),
          promptIndex: 41,
          trigger: 'restate',
          withReport: false
        }
      ]);
    });

    it('should record the rejected reply verbatim with the reason and its alerts', () => {
      expect(records).toEqual([
        {
          id: expect.any(String),
          session: SESSION,
          project: expect.any(String),
          promptIndex: 41,
          sinceReminder: 19,
          model: null,
          reason: 'verbal shorthand',
          prompt: 'how do we ship?',
          rejected: {
            text: 'We ship synergy.',
            alerts: [{ check: 'JustSaySo.Buzzwords', severity: 'error', line: 1, match: 'synergy', message: "Banned buzzword: 'synergy'." }]
          },
          rewrite: null,
          version: expect.any(String),
          config: {
            files: { mode: 'warn' },
            publish: { mode: 'block', gh: false, mcp: 0 },
            reply: { mode: 'warn' },
            rules: { onViolation: true }
          }
        }
      ]);
    });

    it('should hold the record open, mark the injection, and consume the waiting counts', () => {
      expect({
        pendingRewrite: state.pendingRewrite,
        promptCount: state.promptCount,
        promptAtLastReminder: state.promptAtLastReminder,
        replyAlerts: state.replyAlerts
      }).toEqual({
        pendingRewrite: records[0].id,
        promptCount: 41,
        promptAtLastReminder: 41,
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

  describe('when reply counts wait under the default config', () => {
    let context, state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      context = run(promptEvent(sandbox), sandbox.env).hookSpecificOutput.additionalContext;
      state = readSession(SESSION, sandbox.env);
    });

    it('should log a report-triggered reminder event', () => {
      expect(reminderEvents(sandbox.env)).toEqual([{ promptIndex: 2, trigger: 'report', withReport: true }]);
    });

    it('should fire on the next prompt with the rules and then the report', () => {
      expect(context).toMatch(/^## Communication rules — reminder[^]*\n\nRecent replies broke these rules[^]*"synergy" \(2\)/);
    });

    it('should clear the counts and mark the prompt it fired on', () => {
      expect({ replyAlerts: state.replyAlerts, at: state.promptAtLastReminder }).toEqual({ replyAlerts: {}, at: 2 });
    });
  });

  describe('when no reply counts wait under the default config', () => {
    let outputs, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      outputs = Array.from({ length: 25 }, () => run(promptEvent(sandbox), sandbox.env));
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent on every prompt and only count them', () => {
      expect({ fired: outputs.map(fired).some(Boolean), promptCount: state.promptCount }).toEqual({ fired: false, promptCount: 25 });
    });
  });

  describe('when reply counts wait but onViolation is off', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ rules: { onViolation: false } });
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      output = run(promptEvent(sandbox), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and hold the counts for the next context start', () => {
      expect({ output, replyAlerts: state.replyAlerts, at: state.promptAtLastReminder }).toEqual({ output: null, replyAlerts: COUNTS, at: null });
    });
  });

  describe('when counts linger in state but the reply check is off', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'off' } });
      writeSession(SESSION, { promptCount: 1, replyAlerts: COUNTS }, sandbox.env);
      output = run(promptEvent(sandbox), sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and leave the counts alone', () => {
      expect({ output, replyAlerts: state.replyAlerts }).toEqual({ output: null, replyAlerts: COUNTS });
    });
  });

});
