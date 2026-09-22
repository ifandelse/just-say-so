import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from '../helpers/sandbox.js';

/*
 * Integration: the JSON-over-stdin protocol of the four entry scripts.
 * The logic branches live in test/hooks/; this tier proves the process
 * contract — stdout JSON, exit 0 always, resilience to garbage input —
 * and that hooks.json points at files that exist.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = ['remind.js', 'check-banned.js', 'session-start.js', 'subagent-start.js', 'check-output.js'];

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

  describe('when a banned Write goes through the spawned gate in block mode', () => {
    let result;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      result = spawnHook(
        'check-banned.js',
        {
          session_id: 'PROTO_SESSION',
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'notes.md'), content: 'We leverage synergy.' }
        },
        sandbox.env
      );
    });

    it('should exit 0 and emit the deny decision', () => {
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    });
  });

  describe('when a banned gh command goes through the spawned gate in block mode', () => {
    let result;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } });
      result = spawnHook(
        'check-banned.js',
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

  describe('when a banned reply hits the spawned output check in warn mode', () => {
    let result;

    beforeEach(() => {
      const sandbox = makeSandbox({ outputCheck: { mode: 'warn' } });
      result = spawnHook(
        'check-output.js',
        { session_id: 'PROTO_SESSION', cwd: sandbox.work, last_assistant_message: 'we leverage synergy' },
        sandbox.env
      );
    });

    it('should exit 0, print the report to stderr, and keep stdout empty', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: '' });
      expect(result.stderr).toContain('just-say-so: your last reply contains banned terms:');
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
      // three PreToolUse entries (file tools, Bash, MCP) share check-banned.js
      expect(new Set(scriptPaths).size).toBe(SCRIPTS.length);
      expect(scriptPaths.map((p) => fs.existsSync(p))).toEqual(scriptPaths.map(() => true));
    });
  });
});
