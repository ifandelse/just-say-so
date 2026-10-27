import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run } from './check-output.js';
import { readSession, writeSession } from '../state.js';
import { rejectionsFile, appendRecord, readRecords } from '../rejections.js';
import { eventsFile, readEvents } from '../events.js';
import { makeSandbox, writeTranscript } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-output.js
 *   both modes off → null · anchor falls back to recorded projectDir ·
 *   reply: last_assistant_message preferred · transcript fallback · no text →
 *     no reply errors · vale broken → treated clean ·
 *     errors only (warnings never gate the reply)
 *   warn: counts recorded, nothing returned · counts accumulate
 *   block (reply): decision block with outputIntro
 *   gate (files block): outstanding errors re-lint → remaining block
 *     with file paths · fixed → record cleared, no block · vale broken →
 *     skip file, keep record · empty record pruned · budget caps a
 *     pre-existing twin · warn reply + gate block → gate blocks alone
 *   pending rewrite: record completed with the reply and its alerts, pending
 *     cleared, even with both checks off · warn mode still counts the rewrite ·
 *     block mode keeps the record open through a blocked reply and closes it on
 *     the reply that passes · stand-down closes it with the reply that stood
 *   stand-down: stop_hook_active + identical keys → systemMessage, no block ·
 *     different keys → block again · clean pass clears lastStopBlock
 *   waiver: stand-down waives gate alerts → next turn passes, record pruned ·
 *     second instance of a waived alert blocks on the new line · the waived
 *     line moved → first instance of the key is the waived one · reply-only
 *     stand-down waives nothing and uses its own message · deleted file →
 *     record and waiver pruned
 *   events: a reply event per Stop with outcome pass | block | standdown, alerts
 *     at every level, sinceReminder, rewriteOf when a record closed · checks
 *     off still lint for the log · vale broken → alerts null · model read from
 *     the transcript once and cached · events off → no file and no lint ·
 *     events path unwritable → the block decision still returns
 */

function replyEvents(env) {
  return readEvents(eventsFile(env)).map(({ e, promptIndex, sinceReminder, outcome, model, alerts, rewriteOf }) => ({
    e,
    promptIndex,
    sinceReminder,
    outcome,
    model,
    alerts,
    rewriteOf
  }));
}

function warningAlert() {
  return errorAlert({ Check: 'AITells.MicDrop', Severity: 'warning', Line: 2, Span: [1, 30], Match: 'That is the whole story, really.' });
}

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
    let output, events, state;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'off' } });
      respond({ 'reply.reply': [errorAlert(), warningAlert()] });
      const transcript = writeTranscript(sandbox.work, 't.jsonl', [
        { type: 'assistant', message: { id: 'm1', model: 'claude-fable-5-1', content: [{ type: 'text', text: 'we ship synergy' }] } }
      ]);
      writeSession(SESSION, { promptCount: 9, promptAtLastReminder: 6 }, sandbox.env);
      output = run(
        { session_id: SESSION, cwd: sandbox.work, transcript_path: transcript, last_assistant_message: 'we ship synergy' },
        sandbox.env
      );
      events = replyEvents(sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should return null and lint once, for the log alone', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    });

    it('should log a passing reply with alerts at every level and cache the model', () => {
      expect({ events, model: state.model }).toEqual({
        events: [
          {
            e: 'reply',
            promptIndex: 9,
            sinceReminder: 3,
            outcome: 'pass',
            model: 'claude-fable-5-1',
            alerts: [
              { check: 'AITells.MicDrop', severity: 'warning', n: 1 },
              { check: 'JustSaySo.Buzzwords', severity: 'error', n: 1, match: 'synergy' }
            ],
            rewriteOf: undefined
          }
        ],
        model: 'claude-fable-5-1'
      });
    });
  });

  describe('when the events path cannot be appended to in block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      fs.mkdirSync(eventsFile(sandbox.env), { recursive: true });
      respond({ 'reply.reply': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
    });

    it('should still block the reply', () => {
      expect(output.decision).toBe('block');
    });
  });

  describe('when both checks and the events log are off', () => {
    let output, logged;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'off' }, events: { mode: 'off' } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'we ship synergy' },
        sandbox.env
      );
      logged = fs.existsSync(eventsFile(sandbox.env));
    });

    it('should return null without linting or logging', () => {
      expect({ output, logged }).toEqual({ output: null, logged: false });
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when a restate record is open and both checks are off', () => {
    let output, state, records;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'off' } });
      appendRecord(rejectionsFile(sandbox.env), { id: 'R1', rejected: { text: 'synergy wins', alerts: [] }, rewrite: null });
      writeSession(SESSION, { pendingRewrite: 'R1' }, sandbox.env);
      respond({ 'reply.reply': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy still' },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
      records = readRecords(rejectionsFile(sandbox.env));
    });

    it('should complete the record with the rewrite and its alerts, and return nothing', () => {
      expect({ output, records }).toEqual({
        output: null,
        records: [
          {
            id: 'R1',
            rejected: { text: 'synergy wins', alerts: [] },
            rewrite: {
              text: 'synergy still',
              alerts: [{ check: 'JustSaySo.Buzzwords', severity: 'error', line: 1, match: 'synergy', message: "Banned buzzword: 'synergy'." }]
            }
          }
        ]
      });
    });

    it('should clear the pending id', () => {
      expect(state.pendingRewrite).toBeNull();
    });
  });

  describe('when a restate record is open in warn mode', () => {
    let state, records;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'warn' } });
      appendRecord(rejectionsFile(sandbox.env), { id: 'R2', rewrite: null });
      writeSession(SESSION, { pendingRewrite: 'R2' }, sandbox.env);
      respond({ 'reply.reply': [errorAlert()] });
      run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy still' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
      records = readRecords(rejectionsFile(sandbox.env));
    });

    it('should complete the record and still count the rewrite for the next report', () => {
      expect({
        rewriteText: records[0].rewrite.text,
        pendingRewrite: state.pendingRewrite,
        counted: state.replyAlerts['JustSaySo.Buzzwords|synergy'].count
      }).toEqual({ rewriteText: 'synergy still', pendingRewrite: null, counted: 1 });
    });
  });

  describe('when a restate record is open and block mode rejects the first rewrite', () => {
    let first, second, afterFirst, afterSecond, events;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      appendRecord(rejectionsFile(sandbox.env), { id: 'R3', rewrite: null });
      writeSession(SESSION, { pendingRewrite: 'R3' }, sandbox.env);
      respond({ 'reply.reply': [errorAlert()] });
      first = run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy still' }, sandbox.env);
      afterFirst = { pending: readSession(SESSION, sandbox.env).pendingRewrite, rewrite: readRecords(rejectionsFile(sandbox.env))[0].rewrite };
      respond({});
      second = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'We ship.', stop_hook_active: true },
        sandbox.env
      );
      afterSecond = { pending: readSession(SESSION, sandbox.env).pendingRewrite, rewrite: readRecords(rejectionsFile(sandbox.env))[0].rewrite };
      events = replyEvents(sandbox.env).map(({ outcome, rewriteOf }) => ({ outcome, rewriteOf }));
    });

    it('should log a block event and then a pass that names the record', () => {
      expect(events).toEqual([
        { outcome: 'block', rewriteOf: undefined },
        { outcome: 'pass', rewriteOf: 'R3' }
      ]);
    });

    it('should block the first reply and keep the record open', () => {
      expect({ decision: first.decision, ...afterFirst }).toEqual({ decision: 'block', pending: 'R3', rewrite: null });
    });

    it('should let the clean reply end the turn and close the record with it', () => {
      expect({ second, ...afterSecond }).toEqual({
        second: null,
        pending: null,
        rewrite: { text: 'We ship.', alerts: [] }
      });
    });
  });

  describe('when a restate record is open and block mode stands down', () => {
    let output, pending, rewriteText, events;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      appendRecord(rejectionsFile(sandbox.env), { id: 'R4', rewrite: null });
      writeSession(
        SESSION,
        { pendingRewrite: 'R4', lastStopBlock: JSON.stringify(['reply|JustSaySo.Buzzwords|synergy']) },
        sandbox.env
      );
      respond({ 'reply.reply': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy still', stop_hook_active: true },
        sandbox.env
      );
      pending = readSession(SESSION, sandbox.env).pendingRewrite;
      rewriteText = readRecords(rejectionsFile(sandbox.env))[0].rewrite.text;
      events = replyEvents(sandbox.env).map(({ outcome, rewriteOf }) => ({ outcome, rewriteOf }));
    });

    it('should log the stand-down with the record it closed', () => {
      expect(events).toEqual([{ outcome: 'standdown', rewriteOf: 'R4' }]);
    });

    it('should stand down and close the record with the reply that stood', () => {
      expect({ systemMessage: output.systemMessage, pending, rewriteText }).toEqual({
        systemMessage: expect.stringContaining('not blocking again'),
        pending: null,
        rewriteText: 'synergy still'
      });
    });
  });

  describe('when the reply has errors in warn mode', () => {
    let output, state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox({ reply: { mode: 'warn' } });
      respond({ 'reply.reply': [errorAlert()] });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should return nothing', () => {
      expect(output).toBeNull();
    });

    it('should record the alert as a per-rule count', () => {
      expect(state.replyAlerts).toEqual({
        'JustSaySo.Buzzwords|synergy': {
          check: 'JustSaySo.Buzzwords',
          match: 'synergy',
          message: "Banned buzzword: 'synergy'.",
          count: 1
        }
      });
    });
  });

  describe('when a second warn-mode reply repeats the rule', () => {
    let state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox({ reply: { mode: 'warn' } });
      respond({ 'reply.reply': [errorAlert()] });
      run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' }, sandbox.env);
      run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy again' }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should accumulate the count', () => {
      expect(state.replyAlerts['JustSaySo.Buzzwords|synergy'].count).toBe(2);
    });
  });

  describe('when the reply has errors in block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      respond({ 'reply.reply': [errorAlert()] });
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
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
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
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      const transcript = writeTranscript(sandbox.work, 'reply.jsonl', [
        { type: 'assistant', message: { id: 'MSG', content: [{ type: 'text', text: 'we ship synergy' }] } }
      ]);
      respond({ 'reply.reply': [errorAlert()] });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: transcript }, sandbox.env);
    });

    it('should fall back to the transcript text and block', () => {
      expect(output.decision).toBe('block');
    });
  });

  describe('when there is no reply text at all', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      respond({ 'reply.reply': [errorAlert()] });
      output = run({ session_id: SESSION, cwd: sandbox.work, transcript_path: '/nope/missing.jsonl' }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when vale is broken during the reply check', () => {
    let output, alerts;

    beforeEach(() => {
      const sandbox = makeSandbox({ reply: { mode: 'block' } });
      mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' },
        sandbox.env
      );
      alerts = replyEvents(sandbox.env).map((e) => e.alerts);
    });

    it('should treat the reply as clean and log it as unlinted', () => {
      expect({ output, alerts }).toEqual({ output: null, alerts: [null] });
    });
  });

  describe('when the session gate finds a recorded error still present', () => {
    let output, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
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
      sandbox = makeSandbox({ files: { mode: 'block' } });
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
      sandbox = makeSandbox({ files: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
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
      sandbox = makeSandbox({ files: { mode: 'block' } });
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
      sandbox = makeSandbox({ files: { mode: 'block' } });
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
      sandbox = makeSandbox({ files: { mode: 'block' } });
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

  describe('when a new turn follows a stand-down', () => {
    let standDown, nextTurn, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({ 'doc.md': [errorAlert({ Span: [6, 12] })] });
      run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      standDown = run({ session_id: SESSION, cwd: sandbox.work, stop_hook_active: true }, sandbox.env);
      nextTurn = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should say the alerts are waived for the session', () => {
      expect(standDown.systemMessage).toContain('waived for the rest of this session');
    });

    it('should not block again and should drop the file record', () => {
      expect({ nextTurn, valeFiles: state.valeFiles, waived: state.waived }).toEqual({
        nextTurn: null,
        valeFiles: {},
        waived: { [file]: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] }
      });
    });
  });

  describe('when a second instance of a waived alert appears', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\nmore synergy\n');
      writeSession(
        SESSION,
        {
          valeFiles: {
            [file]: {
              outstanding: [
                { key: 'JustSaySo.Buzzwords|synergy', line: 1 },
                { key: 'JustSaySo.Buzzwords|synergy', line: 2 }
              ]
            }
          },
          waived: { [file]: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] }
        },
        sandbox.env
      );
      respond({ 'doc.md': [errorAlert({ Line: 1, Span: [6, 12] }), errorAlert({ Line: 2, Span: [6, 12] })] });
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
    });

    it('should block on the new instance only', () => {
      const listed = output.reason.split('\n').filter((l) => l.includes('JustSaySo.Buzzwords'));
      expect({ decision: output.decision, listed }).toEqual({
        decision: 'block',
        listed: [expect.stringContaining(':L2 ')]
      });
    });
  });

  describe('when the waived line has moved', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'intro\npure synergy\n');
      writeSession(
        SESSION,
        {
          valeFiles: { [file]: { outstanding: [{ key: 'JustSaySo.Buzzwords|synergy', line: 2 }] } },
          waived: { [file]: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] }
        },
        sandbox.env
      );
      respond({ 'doc.md': [errorAlert({ Line: 2, Span: [6, 12] })] });
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
    });

    it('should treat the only instance of the key as the waived one', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a reply-only stand-down happens', () => {
    let output, state, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox({ reply: { mode: 'block' } });
      respond({ 'reply.reply': [errorAlert()] });
      run({ session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins' }, sandbox.env);
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'synergy wins', stop_hook_active: true },
        sandbox.env
      );
      state = readSession(SESSION, sandbox.env);
    });

    it('should stand down with the reply message and waive nothing', () => {
      expect({ message: output.systemMessage, waived: state.waived }).toEqual({
        message: expect.stringContaining('remain in the reply'),
        waived: {}
      });
    });
  });

  describe('when a recorded file no longer exists', () => {
    let output, state, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
      file = path.join(sandbox.work, 'gone.md');
      writeSession(
        SESSION,
        { ...gateRecord(file), waived: { [file]: [{ key: 'JustSaySo.Buzzwords|synergy', line: 1 }] } },
        sandbox.env
      );
      respond({});
      output = run({ session_id: SESSION, cwd: sandbox.work }, sandbox.env);
      state = readSession(SESSION, sandbox.env);
    });

    it('should prune the record and its waiver without linting', () => {
      expect({ output, valeFiles: state.valeFiles, waived: state.waived, linted: mockSpawnSync.mock.calls.length }).toEqual({
        output: null,
        valeFiles: {},
        waived: {},
        linted: 0
      });
    });
  });

  describe('when a rewrite changes the alert set but errors remain', () => {
    let output, sandbox, file;

    beforeEach(() => {
      sandbox = makeSandbox({ files: { mode: 'block' } });
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
      sandbox = makeSandbox({ reply: { mode: 'warn' }, files: { mode: 'block' } });
      file = path.join(sandbox.work, 'doc.md');
      fs.writeFileSync(file, 'pure synergy\n');
      writeSession(SESSION, gateRecord(file), sandbox.env);
      respond({
        'reply.reply': [errorAlert({ Match: 'delve', Message: "Banned buzzword: 'delve'." })],
        'doc.md': [errorAlert({ Span: [6, 12] })]
      });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, last_assistant_message: 'we delve in' },
        sandbox.env
      );
    });

    it('should block on the gate alone and still record the reply count', () => {
      expect(output.decision).toBe('block');
      expect(output.reason).not.toContain('your last reply');
      expect(readSession(SESSION, sandbox.env).replyAlerts['JustSaySo.Buzzwords|delve'].count).toBe(1);
    });
  });

  describe('when the event cwd has no project config but one was recorded', () => {
    let output, sandbox;

    beforeEach(() => {
      sandbox = makeSandbox();
      const projectDir = fs.mkdtempSync(path.join(sandbox.work, 'proj-'));
      fs.writeFileSync(path.join(projectDir, '.just-say-so.json'), JSON.stringify({ reply: { mode: 'block' } }));
      writeSession(SESSION, { projectDir }, sandbox.env);
      respond({ 'reply.reply': [errorAlert()] });
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
