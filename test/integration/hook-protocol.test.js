import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, withFakeVale } from '../helpers/sandbox.js';

/*
 * Integration: the JSON-over-stdin protocol of the entry scripts.
 * The logic branches live next to the lib modules; this tier proves the
 * process contract — stdout JSON, exit 0 always, resilience to garbage
 * input — and that hooks.json points at files that exist. Vale is a fake
 * binary on PATH (test/helpers/sandbox.js); nothing here needs the real one.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = [
  'remind.js',
  'pre-gate.js',
  'check-vale.js',
  'session-start.js',
  'subagent-start.js',
  'check-output.js'
];

function spawnHook(script, input, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'src', 'hooks', script)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

describe('hook protocol', () => {
  describe('when the reminder interval is reached over five spawned prompts', () => {
    let results;

    beforeEach(() => {
      const sandbox = makeSandbox();
      const event = { session_id: 'PROTO_SESSION', cwd: sandbox.work, prompt: 'hi' };
      results = [1, 2, 3, 4, 5].map(() => spawnHook('remind.js', event, sandbox.env));
    });

    it('should exit 0 every time', () => {
      expect(results.map((r) => r.status)).toEqual([0, 0, 0, 0, 0]);
    });

    it('should stay silent for four prompts and emit parseable JSON on the fifth', () => {
      expect(results.slice(0, 4).map((r) => r.stdout)).toEqual(['', '', '', '']);
      const fifth = JSON.parse(results[4].stdout);
      expect(fifth.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    });
  });

  describe('when a config edit goes through the spawned pre-gate', () => {
    let result;

    beforeEach(() => {
      const sandbox = makeSandbox();
      result = spawnHook(
        'pre-gate.js',
        {
          session_id: 'PROTO_SESSION',
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, '.just-say-so.json'), content: '{}' }
        },
        sandbox.env
      );
    });

    it('should exit 0 and emit the ask decision', () => {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('ask');
    });
  });

  describe('when a banned gh command goes through the spawned gate in block mode', () => {
    let result;

    beforeEach(() => {
      const sandbox = withFakeVale(makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } }));
      result = spawnHook(
        'pre-gate.js',
        {
          session_id: 'PROTO_SESSION',
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'gh pr comment 42 --body "We leverage synergy."' }
        },
        sandbox.env
      );
    });

    it('should exit 0 and emit the deny decision', () => {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    });
  });

  describe('when a written file goes through the spawned post-write check', () => {
    let result;

    beforeEach(() => {
      const sandbox = withFakeVale(makeSandbox());
      const file = path.join(sandbox.work, 'notes.md');
      fs.writeFileSync(file, 'We leverage synergy.\n');
      result = spawnHook(
        'check-vale.js',
        {
          session_id: 'PROTO_SESSION',
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: file, content: 'We leverage synergy.\n' }
        },
        sandbox.env
      );
    });

    it('should exit 0 and hand the model the facts without blocking', () => {
      expect(result.status).toBe(0);
      const out = JSON.parse(result.stdout);
      expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(out.hookSpecificOutput.additionalContext).toContain('leverage');
      expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    });
  });

  describe('when a banned reply hits the spawned output check in warn mode', () => {
    let result;

    beforeEach(() => {
      const sandbox = withFakeVale(makeSandbox({ outputCheck: { mode: 'warn' } }));
      result = spawnHook(
        'check-output.js',
        { session_id: 'PROTO_SESSION', cwd: sandbox.work, last_assistant_message: 'we leverage synergy' },
        sandbox.env
      );
    });

    it('should exit 0, print the report to stderr, and keep stdout empty', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: '' });
      expect(result.stderr).toContain('just-say-so: Vale reports errors in your last reply:');
    });
  });

  describe('when every script receives garbage stdin', () => {
    let results;

    beforeEach(() => {
      const sandbox = makeSandbox();
      results = SCRIPTS.map((script) => spawnHook(script, 'not json at all', sandbox.env));
    });

    it('should exit 0 with empty stdout across the board', () => {
      expect(results.map((r) => ({ status: r.status, stdout: r.stdout }))).toEqual(
        SCRIPTS.map(() => ({ status: 0, stdout: '' }))
      );
    });
  });

  describe('when hooks.json is resolved against the plugin root', () => {
    let scriptPaths;

    beforeEach(() => {
      const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
      scriptPaths = Object.values(config.hooks)
        .flat()
        .flatMap((matcher) => matcher.hooks)
        .map((h) => h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)/)[1])
        .map((rel) => path.join(ROOT, rel));
    });

    it('should point every command at a file that exists', () => {
      // three PreToolUse entries (file tools, Bash, MCP) share pre-gate.js
      expect(new Set(scriptPaths).size).toBe(SCRIPTS.length);
      expect(scriptPaths.map((p) => fs.existsSync(p))).toEqual(scriptPaths.map(() => true));
    });
  });
});
