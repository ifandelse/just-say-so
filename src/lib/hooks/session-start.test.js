import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './session-start.js';
import { readSession, writeSession, stateDir } from '../state.js';
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
 *   reply check idle (warn + reminder off) → notice, joined with valeMissing
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
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'compact' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
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
        contextAtLastReminder: null,
        replyAlerts: {},
        projectDir: null,
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

    it('should deliver the report, clear the counts, and keep the counters', () => {
      expect({
        reported: output.hookSpecificOutput.additionalContext.includes('"synergy" (2)'),
        replyAlerts: state.replyAlerts,
        promptCount: state.promptCount
      }).toEqual({ reported: true, replyAlerts: {}, promptCount: 4 });
    });
  });

  describe('when the configured list excludes the source', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSessionStart: ['compact'] } });
      valePresent();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, replyAlerts: COUNTS }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should neither inject nor reset, and keep the reply counts for the next reminder', () => {
      expect({ output, promptCount: state.promptCount, replyAlerts: state.replyAlerts }).toEqual({
        output: null,
        promptCount: 4,
        replyAlerts: COUNTS
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

    it('should clean it up', () => {
      expect(remaining).toEqual([]);
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
        outputCheck: { mode: 'warn' }
      });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should say the reply check is idle without probing vale', () => {
      expect(output.systemMessage).toContain('The reply check is idle.');
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when the reply check is idle and vale is missing for the edit check', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { mode: 'off' }, outputCheck: { mode: 'warn' } });
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

  describe('when every check mode is off and vale is missing', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' }, outputCheck: { mode: 'off' } });
      valeMissing();
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
    });

    it('should inject the rules without probing or complaining', () => {
      expect(output.systemMessage).toBeUndefined();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });
});
