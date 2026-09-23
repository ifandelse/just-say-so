import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run, alertKey } from './check-vale.js';
import { readSession, writeSession } from '../state.js';
import { makeSandbox } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-vale.js
 *   unknown tool → null · no file path → null · policy file → null ·
 *   mode off → null · vale broken → null (no state write) ·
 *   Write with alerts → whole-file intro + systemMessage + errors recorded ·
 *   Edit located → alerts outside the added ranges filtered, in-range shown ·
 *   errors cleared by a later edit → state entry removed, silence ·
 *   levels floor hides sub-error alerts → null output, state still updated ·
 *   disableWords drops the only alert → null ·
 *   file unreadable after lint → whole-file fallback
 */

const SESSION = 'VALE_SESSION';

function respond(alertsByBase) {
  mockSpawnSync.mockImplementation((_cmd, args) => {
    if (args[0] === 'ls-dirs') return { status: 0, stdout: '' };
    const target = args[args.length - 1];
    const alerts = alertsByBase[path.basename(target)] ?? [];
    return { status: alerts.length ? 1 : 0, stdout: JSON.stringify({ [target]: alerts }) };
  });
}

function errorAlert(over = {}) {
  return {
    Check: 'JustSaySo.Buzzwords',
    Severity: 'error',
    Line: 1,
    Span: [1, 7],
    Match: 'synergy',
    Message: "Banned buzzword: 'synergy'.",
    ...over
  };
}

describe('check-vale.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when an unrelated tool fires', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: {} }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the tool carries no file path', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: {} }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the written file is a policy file', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, '.vale.ini'), content: '' }
        },
        sandbox.env
      );
    });

    it('should return null without linting', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when the check is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'notes.md'), content: 'synergy' }
        },
        sandbox.env
      );
    });

    it('should return null without linting', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when vale is broken or missing', () => {
    let output, state;

    beforeEach(() => {
      const sandbox = makeSandbox();
      mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
      const file = path.join(sandbox.work, 'notes.md');
      fs.writeFileSync(file, 'pure synergy\n');
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: { file_path: file, content: 'pure synergy\n' } },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should stay silent and record nothing', () => {
      expect(output).toBeNull();
      expect(state.valeFiles).toEqual({});
    });
  });

  describe('when a Write lands with an error alert', () => {
    let output, state, file;

    beforeEach(() => {
      const sandbox = makeSandbox();
      file = path.join(sandbox.work, 'notes.md');
      fs.writeFileSync(file, 'pure synergy\n');
      respond({ 'notes.md': [errorAlert({ Span: [6, 12], Match: 'synergy' })] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: { file_path: file, content: 'pure synergy\n' } },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should report the whole file as in scope', () => {
      expect(output.hookSpecificOutput).toEqual({
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringContaining('whole file')
      });
      expect(output.hookSpecificOutput.additionalContext).toContain('synergy');
    });

    it('should give the person a one-line summary', () => {
      expect(output.systemMessage).toContain('1 error(s)');
      expect(output.systemMessage).toContain('notes.md');
    });

    it('should record the outstanding error for the Stop gate', () => {
      expect(state.valeFiles).toEqual({
        [file]: { outstanding: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] }
      });
    });
  });

  describe('when an Edit adds one line of a larger file', () => {
    let output, state, file;

    beforeEach(() => {
      const sandbox = makeSandbox();
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'old synergy line\nfresh delve line\n');
      respond({
        'doc.md': [
          errorAlert({ Line: 1, Match: 'synergy' }),
          errorAlert({ Line: 2, Match: 'delve', Span: [7, 11], Message: "Banned buzzword: 'delve'." })
        ]
      });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: { file_path: file, old_string: 'stale', new_string: 'fresh delve line' }
        },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should surface only the alert in the added lines', () => {
      expect(output.hookSpecificOutput.additionalContext).toContain('delve');
      expect(output.hookSpecificOutput.additionalContext).not.toContain('synergy');
    });

    it('should describe the scope as the edited lines', () => {
      expect(output.hookSpecificOutput.additionalContext).toContain('lines this edit added');
    });

    it('should record only the in-range error', () => {
      expect(state.valeFiles[file].outstanding).toEqual([{ key: 'JustSaySo.Buzzwords|delve', line: 2 }]);
    });
  });

  describe('when a later edit fixes the recorded errors', () => {
    let output, state, file;

    beforeEach(() => {
      const sandbox = makeSandbox();
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'clean line\n');
      writeSession(
        SESSION,
        { valeFiles: { [file]: { outstanding: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] } } },
        sandbox.env
      );
      respond({ 'doc.md': [] });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: { file_path: file, old_string: 'pure synergy', new_string: 'clean line' }
        },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should clear the record and stay silent', () => {
      expect(output).toBeNull();
      expect(state.valeFiles).toEqual({});
    });
  });

  describe('when the level floor hides sub-error alerts', () => {
    let output, state, file;

    beforeEach(() => {
      const sandbox = makeSandbox({ vale: { levels: 'error' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'very nice\n');
      respond({ 'doc.md': [errorAlert({ Severity: 'suggestion', Match: 'very', Span: [1, 4] })] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: { file_path: file, content: 'very nice\n' } },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should return null and record no errors', () => {
      expect(output).toBeNull();
      expect(state.valeFiles).toEqual({});
    });
  });

  describe('when disableWords exempts the only alert', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { disableWords: ['synergy'] } });
      const file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      respond({ 'doc.md': [errorAlert({ Span: [6, 12] })] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: { file_path: file, content: 'pure synergy\n' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the file cannot be read back after the lint', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      const file = path.join(sandbox.work, 'ghost.md');
      respond({ 'ghost.md': [errorAlert()] });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: { file_path: file, old_string: 'a', new_string: 'b' }
        },
        sandbox.env
      );
    });

    it('should fall back to whole-file scope', () => {
      expect(output.hookSpecificOutput.additionalContext).toContain('whole file');
    });
  });

  describe('alertKey', () => {
    let key;

    beforeEach(() => {
      key = alertKey({ Check: 'JustSaySo.Buzzwords', Match: 'SynErgy' });
    });

    it('should fold case so edits that re-case a match still count as the same error', () => {
      expect(key).toBe('JustSaySo.Buzzwords|synergy');
    });
  });
});
