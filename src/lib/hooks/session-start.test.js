import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './session-start.js';
import { run as runRemind } from './remind.js';
import { readSession, writeSession, stateDir } from '../state.js';
import { eventsFile, readEvents } from '../events.js';
import { makeSandbox } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/session-start.js
 *   source compact → reset + inject (default list holds all four sources)
 *   source clear → reset + inject
 *   source startup → no reset + inject
 *   source outside a trimmed configured list → null, no reset
 *   source missing → defaults to "startup" → inject
 *   cleanupSessions runs on every call (old files removed)
 *   vale probe: checks on + probe fails → systemMessage (with or without
 *     rules injection) · probe passes → no message · checks off → no probe
 *   reply counts: injection carries the report · compact resets them ·
 *     resume clears them and keeps the counters · no injection → kept
 *   interval baseline: resume/startup injection moves promptAtLastReminder to
 *     promptCount and clears the token baseline, so the next prompt does not
 *     inject again · no injection → baselines untouched
 *   reply check idle (warn + next-reminder + reminder off) → notice, joined with valeMissing
 *   events: session event with the config snapshot and the probe result ·
 *     reminder event (trigger session) only on injection, promptIndex 0 after a
 *     reset · checks off still probe for the log · events off → no probe, no file
 */

const COUNTS = { 'JustSaySo.Buzzwords|synergy': { check: 'JustSaySo.Buzzwords', match: 'synergy', message: "Banned buzzword: 'synergy'.", count: 2 } };

const SESSION = 'START_SESSION';

function valePresent() {
  mockSpawnSync.mockReturnValue({ status: 0, stdout: '' });
}

function valeMissing() {
  mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
}

describe('session-start.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when the session compacts', () => {
    let output, state, events, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'compact' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
      events = readEvents(eventsFile(sandbox.env));
    });

    it('should log the session with its config and a reminder event at prompt 0', () => {
      expect(events).toEqual([
        {
          t: expect.any(String),
          e: 'session',
          session: SESSION,
          project: sandbox.work,
          v: expect.any(String),
          source: 'compact',
          vale: true,
          config: {
            reminder: { mode: 'prompts', everyPrompts: 20 },
            outputCheck: { mode: 'warn', deliver: 'next-prompt' },
            bannedCheck: { mode: 'warn' },
            vale: { levels: 'suggestion' }
          }
        },
        {
          t: expect.any(String),
          e: 'reminder',
          session: SESSION,
          project: sandbox.work,
          v: expect.any(String),
          promptIndex: 0,
          trigger: 'session',
          withReport: true
        }
      ]);
    });

    it('should inject the condensed rules with the reply report after them', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: expect.stringMatching(/^## Communication rules — reminder[^]*Recent replies broke these rules[^]*"synergy" \(2\)/)
        }
      });
    });

    it('should reset the session counters', () => {
      expect(state).toEqual({
        promptCount: 0,
        promptAtLastReminder: null,
        contextAtLastReminder: null,
        replyAlerts: {},
        pendingRewrite: null,
        projectDir: null,
        model: null,
        valeFiles: {},
        waived: {},
        lastStopBlock: null
      });
    });
  });

  describe('when the session clears', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'clear' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should reset the counters and inject', () => {
      expect({
        injected: output.hookSpecificOutput.additionalContext.includes('## Communication rules — reminder'),
        promptCount: state.promptCount
      }).toEqual({ injected: true, promptCount: 0 });
    });
  });

  describe('when a new session starts up', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should inject without resetting the counters', () => {
      expect({
        injected: output.hookSpecificOutput.hookEventName === 'SessionStart',
        promptCount: state.promptCount
      }).toEqual({ injected: true, promptCount: 4 });
    });
  });

  describe('when a session resumes with reply counts waiting', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'resume' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should deliver the report, clear the counts, keep the prompt count, and reset the interval', () => {
      expect({
        reported: output.hookSpecificOutput.additionalContext.includes('"synergy" (2)'),
        replyAlerts: state.replyAlerts,
        promptCount: state.promptCount,
        promptAtLastReminder: state.promptAtLastReminder,
        contextAtLastReminder: state.contextAtLastReminder
      }).toEqual({ reported: true, replyAlerts: {}, promptCount: 4, promptAtLastReminder: 4, contextAtLastReminder: null });
    });
  });

  describe('when a resume delivers the report one prompt short of the interval', () => {
    let resumed, nextPrompt;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 19, promptAtLastReminder: 0, replyAlerts: COUNTS }, sandbox.env);
      resumed = run({ session_id: SESSION, cwd: sandbox.work, source: 'resume' }, sandbox.env);
      nextPrompt = runRemind({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
    });

    it('should inject once on resume and stay silent on the next prompt', () => {
      expect({ resumed: resumed.hookSpecificOutput.hookEventName, nextPrompt }).toEqual({
        resumed: 'SessionStart',
        nextPrompt: null
      });
    });
  });

  describe('when the configured list excludes the source', () => {
    let output, state, events;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSessionStart: ['compact'] } });
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
      events = readEvents(eventsFile(sandbox.env));
    });

    it('should log the session alone, at the kept prompt count', () => {
      expect(events.map(({ e, source, promptIndex }) => ({ e, source, promptIndex }))).toEqual([
        { e: 'session', source: 'startup', promptIndex: undefined }
      ]);
    });

    it('should neither inject nor reset, and keep the reply counts for the next reminder', () => {
      expect({
        output,
        promptCount: state.promptCount,
        replyAlerts: state.replyAlerts,
        contextAtLastReminder: state.contextAtLastReminder
      }).toEqual({
        output: null,
        promptCount: 4,
        replyAlerts: COUNTS,
        contextAtLastReminder: 900
      });
    });
  });

  describe('when the source is missing and "startup" is configured for injection', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSessionStart: ['startup'] } });
      valePresent();
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
    });

    it('should default the source to startup and inject', () => {
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
  });

  describe('when a week-old session file lingers', () => {
    let remaining;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession('OLD_TIMER', { promptCount: 1 }, sandbox.env);
      const oldFile = path.join(stateDir(sandbox.env), 'sessions', 'OLD_TIMER.json');
      const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
      fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);
      run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      remaining = fs.readdirSync(path.join(stateDir(sandbox.env), 'sessions'));
    });

    it('should clean it up and leave only the current session', () => {
      expect(remaining).toEqual([`${SESSION}.json`]);
    });
  });

  describe('when checks are on and vale is missing', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should say so once alongside the rules injection', () => {
      expect(output.systemMessage).toContain('vale binary is missing');
      expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
  });

  describe('when vale is missing and the source injects no rules', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSessionStart: ['compact'] } });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should return the notice alone', () => {
      expect(output).toEqual({ systemMessage: expect.stringContaining('vale binary is missing') });
    });
  });

  describe('when the reply check is warn but the reminder is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({
        reminder: { mode: 'off' },
        bannedCheck: { mode: 'off' },
        outputCheck: { mode: 'warn', deliver: 'next-reminder' }
      });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should say the reply check is idle, and probe for the log without complaining', () => {
      expect(output.systemMessage).toContain('The reply check is idle.');
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the reply check is idle and vale is missing for the edit check', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'off' }, outputCheck: { mode: 'warn', deliver: 'next-reminder' } });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should join both notices on separate lines', () => {
      expect(output.systemMessage.split('\n')).toEqual([
        expect.stringContaining('vale binary is missing'),
        expect.stringContaining('The reply check is idle.')
      ]);
    });
  });

  describe('when every check mode and the events log are off and vale is missing', () => {
    let output, logged;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' }, outputCheck: { mode: 'off' }, events: { mode: 'off' } });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      logged = fs.existsSync(eventsFile(sandbox.env));
    });

    it('should inject the rules without probing, complaining, or logging', () => {
      expect({ systemMessage: output.systemMessage, logged }).toEqual({ systemMessage: undefined, logged: false });
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when the checks are off but the log is on and vale is missing', () => {
    let output, vale;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' }, outputCheck: { mode: 'off' } });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      vale = readEvents(eventsFile(sandbox.env))[0].vale;
    });

    it('should probe for the log, record the miss, and stay quiet about it', () => {
      expect({ systemMessage: output.systemMessage, vale }).toEqual({ systemMessage: undefined, vale: false });
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    });
  });
});
