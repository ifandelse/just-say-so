import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession } from '../src/lib/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_TRANSCRIPT = path.join(ROOT, 'test', 'fixtures', 'transcript.jsonl');

function runHookScript(script, input, env) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'src', 'hooks', script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
  assert.equal(result.status, 0, `${script} must always exit 0 (stderr: ${result.stderr})`);
  return result;
}

// Isolated sandbox per test: config file (optional) + state dir, no leakage
// from the developer's real ~/.config/just-say-so.
function sandbox(config) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-hooks-'));
  const configFile = path.join(work, 'config.json');
  if (config) fs.writeFileSync(configFile, JSON.stringify(config));
  const stateDir = path.join(work, 'state');
  return {
    work,
    env: { JUST_SAY_SO_CONFIG: configFile, JUST_SAY_SO_STATE_DIR: stateDir },
    stateEnv: { JUST_SAY_SO_STATE_DIR: stateDir }
  };
}

function transcriptWithContext(dir, name, inputTokens) {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    JSON.stringify({ type: 'assistant', message: { id: 'm', usage: { input_tokens: inputTokens } } }) + '\n'
  );
  return file;
}

test('remind: fires on the 5th prompt by default, then goes quiet again', () => {
  const { work, env } = sandbox();
  const input = { session_id: 'prompts-mode', cwd: work, hook_event_name: 'UserPromptSubmit', prompt: 'hi' };

  for (let i = 1; i <= 4; i++) {
    assert.equal(runHookScript('remind.js', input, env).stdout, '', `prompt ${i} must be silent`);
  }
  const fifth = JSON.parse(runHookScript('remind.js', input, env).stdout);
  assert.equal(fifth.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(fifth.hookSpecificOutput.additionalContext, /## Communication rules — reminder/);
  assert.equal(runHookScript('remind.js', input, env).stdout, '', 'prompt 6 must be silent');
});

test('remind: token mode fires after the configured context growth', () => {
  const { work, env } = sandbox({ reminder: { mode: 'tokens', everyTokens: 100 } });
  const base = (name, tokens) => ({
    session_id: 'token-mode',
    cwd: work,
    hook_event_name: 'UserPromptSubmit',
    transcript_path: transcriptWithContext(work, name, tokens)
  });

  assert.equal(runHookScript('remind.js', base('t1.jsonl', 1000), env).stdout, '', 'baseline run is silent');
  assert.equal(runHookScript('remind.js', base('t2.jsonl', 1050), env).stdout, '', 'growth of 50 < 100');
  const fired = JSON.parse(runHookScript('remind.js', base('t3.jsonl', 1200), env).stdout);
  assert.match(fired.hookSpecificOutput.additionalContext, /## Communication rules — reminder/);
  assert.equal(runHookScript('remind.js', base('t4.jsonl', 1200), env).stdout, '', 'no growth after firing');
});

test('check-banned: denies a Write whose content has banned terms', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'check-banned.js',
    {
      session_id: 'deny',
      cwd: work,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(work, 'notes.md'),
        content: 'We leverage robust solutions in order to ship.'
      }
    },
    env
  );
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /"leverage" ×1 — use a concrete verb/);
  assert.match(out.permissionDecisionReason, /"in order to" ×1/);
});

test('check-banned: clean content passes silently', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'check-banned.js',
    {
      session_id: 'clean',
      cwd: work,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(work, 'notes.md'), content: 'The scheduler retries the job.' }
    },
    env
  );
  assert.equal(result.stdout, '');
});

test('check-banned: default exclude globs skip package.json and friends', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'check-banned.js',
    {
      session_id: 'excluded',
      cwd: work,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(work, 'package.json'), content: '"robust": "a banned word"' }
    },
    env
  );
  assert.equal(result.stdout, '');
});

test('check-banned: Edit checks only new_string, not the text being replaced', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'check-banned.js',
    {
      session_id: 'edit-scope',
      cwd: work,
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(work, 'notes.md'),
        old_string: 'our robust, seamless platform',
        new_string: 'our platform'
      }
    },
    env
  );
  assert.equal(result.stdout, '');
});

test('check-banned: warn mode allows the call and injects feedback instead', () => {
  const { work, env } = sandbox({ bannedCheck: { mode: 'warn' } });
  const result = runHookScript(
    'check-banned.js',
    {
      session_id: 'warn',
      cwd: work,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(work, 'notes.md'), content: 'a seamless experience' }
    },
    env
  );
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, undefined);
  assert.match(out.additionalContext, /"seamless" ×1/);
});

test('session-start: compact injects the reminder and resets counters', () => {
  const { work, env, stateEnv } = sandbox();
  const promptInput = { session_id: 'compact-me', cwd: work, hook_event_name: 'UserPromptSubmit' };
  for (let i = 0; i < 3; i++) runHookScript('remind.js', promptInput, env);
  assert.equal(readSession('compact-me', stateEnv).promptCount, 3);

  const result = runHookScript(
    'session-start.js',
    { session_id: 'compact-me', cwd: work, hook_event_name: 'SessionStart', source: 'compact' },
    env
  );
  const out = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'SessionStart');
  assert.match(out.additionalContext, /## Communication rules — reminder/);
  assert.equal(readSession('compact-me', stateEnv).promptCount, 0);
});

test('session-start: sources outside the configured list stay silent', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'session-start.js',
    { session_id: 'startup-silent', cwd: work, hook_event_name: 'SessionStart', source: 'startup' },
    env
  );
  assert.equal(result.stdout, '');
});

test('check-output: off by default', () => {
  const { work, env } = sandbox();
  const result = runHookScript(
    'check-output.js',
    { session_id: 'off', cwd: work, hook_event_name: 'Stop', transcript_path: FIXTURE_TRANSCRIPT },
    env
  );
  assert.equal(result.stdout, '');
});

test('check-output: block mode rejects a reply with banned terms', () => {
  const { work, env } = sandbox({ outputCheck: { mode: 'block' } });
  const input = { session_id: 'block', cwd: work, hook_event_name: 'Stop', transcript_path: FIXTURE_TRANSCRIPT };

  const out = JSON.parse(runHookScript('check-output.js', input, env).stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /"leverage" ×1/);
  assert.match(out.reason, /"synergy" ×1/);

  // Never loop on our own rewrite request.
  const looped = runHookScript('check-output.js', { ...input, stop_hook_active: true }, env);
  assert.equal(looped.stdout, '');
});

test('check-output: warn mode queues a note that remind delivers next prompt', () => {
  const { work, env, stateEnv } = sandbox({ outputCheck: { mode: 'warn' } });
  const stop = runHookScript(
    'check-output.js',
    { session_id: 'warn-queue', cwd: work, hook_event_name: 'Stop', transcript_path: FIXTURE_TRANSCRIPT },
    env
  );
  assert.equal(stop.stdout, '');
  assert.equal(readSession('warn-queue', stateEnv).pendingNotes.length, 1);

  const next = runHookScript(
    'remind.js',
    { session_id: 'warn-queue', cwd: work, hook_event_name: 'UserPromptSubmit' },
    env
  );
  const out = JSON.parse(next.stdout).hookSpecificOutput;
  assert.match(out.additionalContext, /banned terms/);
  assert.equal(readSession('warn-queue', stateEnv).pendingNotes.length, 0);
});

test('check-banned: a project .just-say-so.json adds relative exclude globs', () => {
  const { work, env } = sandbox();
  fs.writeFileSync(path.join(work, '.just-say-so.json'), JSON.stringify({ bannedCheck: { exclude: ['docs/**'] } }));
  fs.mkdirSync(path.join(work, 'docs'), { recursive: true });
  const base = (file) => ({
    session_id: 'project-config',
    cwd: work,
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: path.join(work, file), content: 'a robust plan' }
  });

  assert.equal(runHookScript('check-banned.js', base('docs/notes.md'), env).stdout, '', 'excluded dir');
  const denied = JSON.parse(runHookScript('check-banned.js', base('other.md'), env).stdout);
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
});

test('hook scripts survive garbage stdin without failing', () => {
  const { env } = sandbox();
  for (const script of ['remind.js', 'check-banned.js', 'session-start.js', 'check-output.js']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'src', 'hooks', script)], {
      input: 'not json at all',
      encoding: 'utf8',
      env: { ...process.env, ...env }
    });
    assert.equal(result.status, 0, `${script} must exit 0 on garbage input`);
    assert.equal(result.stdout, '');
  }
});
