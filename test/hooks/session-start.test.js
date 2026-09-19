import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../src/lib/hooks/session-start.js';
import { readSession, writeSession, stateDir } from '../../src/lib/state.js';
import { makeSandbox } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/session-start.js
 *   source compact (in default list) → reset + inject
 *   source clear (not in list) → reset + null
 *   source startup → no reset + null
 *   source missing → defaults to "startup"; with it configured → inject
 *   cleanupSessions runs on every call (old files removed)
 */

const SESSION = 'START_SESSION';

describe('session-start.run', () => {
  describe('when the session compacts', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, pendingNotes: [] }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'compact' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should inject the condensed rules', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: expect.stringContaining('## Communication rules — reminder')
        }
      });
    });

    it('should reset the session counters', () => {
      expect(state).toEqual({ promptCount: 0, contextAtLastReminder: null, pendingNotes: [] });
    });
  });

  describe('when the session clears', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, pendingNotes: [] }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'clear' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should reset the counters without injecting', () => {
      expect({ output, promptCount: state.promptCount }).toEqual({ output: null, promptCount: 0 });
    });
  });

  describe('when the session starts up normally', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      writeSession(SESSION, { promptCount: 4, contextAtLastReminder: 900, pendingNotes: [] }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, source: 'startup' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should neither inject nor reset', () => {
      expect({ output, promptCount: state.promptCount }).toEqual({ output: null, promptCount: 4 });
    });
  });

  describe('when the source is missing and "startup" is configured for injection', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSessionStart: ['startup'] } });
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
});
