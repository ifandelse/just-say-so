import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './check-output.js';
import { readSession, writeSession } from '../state.js';
import { makeSandbox, writeTranscript } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-output.js
 *   both modes off → null · anchor falls back to recorded projectDir ·
 *   reply: last_assistant_message preferred · transcript fallback · no text →
 *     no reply errors · vale broken → treated clean · exemptions apply ·
 *     errors only (warnings never gate the reply)
 *   warn: stderr + pendingNotes queued, capped at 3
 *   block (reply): decision block with outputIntro
 *   gate (bannedCheck block): outstanding errors re-lint → remaining block
 *     with file paths · fixed → record cleared, no block · vale broken →
 *     skip file, keep record · empty record pruned · budget caps a
 *     pre-existing twin · warn reply + gate block → gate blocks alone
 *   stand-down: stop_hook_active + identical keys → systemMessage, no block ·
 *     different keys → block again · clean pass clears lastStopBlock
 */

const SESSION = 'OUTPUT_SESSION';

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

function gateRecord(file, key = 'JustSaySo.Buzzwords|synergy') {
  return { valeFiles: { [file]: { outstanding: [{ key, line: 1 }] } } };
}

describe('check-output.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when both checks are off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'we ship synergy' },
        sandbox.env
      );
    });

    it('should return null without linting', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when the reply has errors in warn mode', () => {
    let output, state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox({ outputCheck: { mode: 'warn' } });
      respond({ 'reply.chat.md': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should return the report as stderr', () => {
      expect(output.stderr).toContain('just-say-so: Vale reports errors in your last reply:');
      expect(output.stderr).toContain('synergy');
    });

    it('should queue the note for the next prompt', () => {
      expect(state.pendingNotes).toHaveLength(1);
    });
  });

  describe('when warn notes pile past the cap', () => {
    let state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox({ outputCheck: { mode: 'warn' } });
      writeSession(SESSION, { pendingNotes: ['ONE', 'TWO', 'THREE'] }, sandbox.env);
      respond({ 'reply.chat.md': [errorAlert()] });
      run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy again' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should keep only the newest three', () => {
      expect(state.pendingNotes).toHaveLength(3);
      expect(state.pendingNotes[0]).toBe('TWO');
    });
  });

  describe('when the reply has errors in block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      respond({ 'reply.chat.md': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
    });

    it('should block with the rewrite instruction', () => {
      expect(output.decision).toBe('block');
      expect(output.reason).toContain('just-say-so: Vale reports errors in your last reply:');
      expect(output.reason).toContain('Rewrite the reply per the communication rules.');
    });
  });

  describe('when the reply is clean', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      respond({});
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'The tests pass.' },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when only the transcript carries the reply', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      const transcript = writeTranscript(sandbox.work, 'reply.jsonl', [
        { type: 'assistant', message: { id: 'MSG', content: [{ type: 'text', text: 'we ship synergy' }] } }
      ]);
      respond({ 'reply.chat.md': [errorAlert()] });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: transcript }, sandbox.env);
    });

    it('should fall back to the transcript text and block', () => {
      expect(output.decision).toBe('block');
    });
  });

  describe('when there is no reply text at all', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      respond({ 'reply.chat.md': [errorAlert()] });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: '/nope/missing.jsonl' }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when vale is broken during the reply check', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'block' } });
      mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
    });

    it('should treat the reply as clean', () => {
      expect(output).toBeNull();
    });
  });

  describe('when an allowed phrase covers the reply match', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({
        outputCheck: { mode: 'block' },
        bannedCheck: { allowPhrases: ['robust regression'] }
      });
      const reply = 'the robust regression suite passed';
      const start = reply.indexOf('robust') + 1;
      respond({ 'reply.chat.md': [errorAlert({ Match: 'robust', Span: [start, start + 5] })] });
      output = run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: reply }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the session gate finds a recorded error still present', () => {
    let output, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({ 'doc.md': [errorAlert({ Span: [6, 12] })] });
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should block and name the file', () => {
      expect(output.decision).toBe('block');
      expect(output.reason).toContain('error-level Vale alerts remain in files this session wrote:');
      expect(output.reason).toContain(file);
    });

    it('should remember the blocked alert set', () => {
      expect(state.lastStopBlock).toContain('JustSaySo.Buzzwords|synergy');
    });
  });

  describe('when the recorded errors are fixed', () => {
    let output, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'clean\n');
      writeSession(SESSION, { ...gateRecord(file), lastStopBlock: 'STALE' }, sandbox.env);
      respond({});
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should not block, clear the record, and forget the last block', () => {
      expect(output).toBeNull();
      expect(state.valeFiles).toEqual({});
      expect(state.lastStopBlock).toBeNull();
    });
  });

  describe('when vale breaks during the gate re-lint', () => {
    let output, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should never block on stale records and keep them for later', () => {
      expect(output).toBeNull();
      expect(state.valeFiles[file].outstanding).toHaveLength(1);
    });
  });

  describe('when a record holds no outstanding errors', () => {
    let state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      writeSession(SESSION, { valeFiles: { [file]: { outstanding: [] } } }, sandbox.env);
      respond({});
      run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should prune the empty record', () => {
      expect(state.valeFiles).toEqual({});
    });
  });

  describe('when the file holds a pre-existing twin of the recorded error', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'synergy\nsynergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({ 'doc.md': [errorAlert({ Line: 1 }), errorAlert({ Line: 2 })] });
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
    });

    it('should gate only as many as were recorded', () => {
      const listed = output.reason.split('\n').filter((l) => l.includes('JustSaySo.Buzzwords'));
      expect(listed).toHaveLength(1);
    });
  });

  describe('when a rewrite leaves the blocked alert set unchanged', () => {
    let first, output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({ 'doc.md': [errorAlert({ Span: [6, 12] })] });
      first = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      output = run({ session_id: SESSION, cwd: sandbox.work, stop_hook_active: true }, sandbox.env);
    });

    it('should block the first pass', () => {
      expect(first.decision).toBe('block');
    });

    it('should stand down with a system message instead of blocking again', () => {
      expect(output.decision).toBeUndefined();
      expect(output.systemMessage).toContain('not blocking again');
    });
  });

  describe('when a rewrite changes the alert set but errors remain', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy and delve\n');
      writeSession(
        SESSION,
        {
          valeFiles: {
            [file]: {
              outstanding: [
                { key: 'JustSaySo.Buzzwords|synergy', line: 1 },
                { key: 'JustSaySo.Buzzwords|delve', line: 1 }
              ]
            }
          },
          lastStopBlock: JSON.stringify([`${file}|JustSaySo.Buzzwords|delve`, `${file}|JustSaySo.Buzzwords|synergy`])
        },
        sandbox.env
      );
      respond({ 'doc.md': [errorAlert({ Span: [6, 12] })] });
      output = run({ session_id: SESSION, cwd: sandbox.work, stop_hook_active: true }, sandbox.env);
    });

    it('should block again on the smaller set', () => {
      expect(output.decision).toBe('block');
    });
  });

  describe('when the reply warns while the gate blocks', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ outputCheck: { mode: 'warn' }, bannedCheck: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({
        'reply.chat.md': [errorAlert({ Match: 'delve', Message: "Banned buzzword: 'delve'." })],
        'doc.md': [errorAlert({ Span: [6, 12] })]
      });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'we delve in' },
        sandbox.env
      );
    });

    it('should block on the gate alone', () => {
      expect(output.decision).toBe('block');
      expect(output.reason).not.toContain('your last reply');
    });
  });

  describe('when the event cwd has no project config but one was recorded', () => {
    let output, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox();
      const projectDir = fs.mkdtempSync(path.join(sandbox.work, 'proj-'));
      fs.writeFileSync(path.join(projectDir, '.just-say-so.json'), JSON.stringify({ outputCheck: { mode: 'block' } }));
      writeSession(SESSION, { projectDir }, sandbox.env);
      respond({ 'reply.chat.md': [errorAlert()] });
      output = run(
        {
          session_id: SESSION,
          cwd: fs.mkdtempSync(path.join(sandbox.work, 'elsewhere-')),
          last_assistant_message: 'synergy wins'
        },
        sandbox.env
      );
    });

    it('should anchor on the recorded project and block', () => {
      expect(output.decision).toBe('block');
    });
  });
});
