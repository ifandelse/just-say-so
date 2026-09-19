import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, DEFAULTS } from '../src/lib/config.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-config-'));
}

test('no config files yields the defaults', () => {
  const cwd = tmpdir();
  const env = { JUST_SAY_SO_CONFIG: path.join(cwd, 'nope.json') };
  assert.deepEqual(loadConfig(cwd, env), DEFAULTS);
});

test('global config merges over defaults', () => {
  const dir = tmpdir();
  const globalFile = path.join(dir, 'config.json');
  fs.writeFileSync(globalFile, JSON.stringify({ reminder: { everyPrompts: 3 } }));
  const config = loadConfig(dir, { JUST_SAY_SO_CONFIG: globalFile });
  assert.deepEqual(config.reminder, { ...DEFAULTS.reminder, everyPrompts: 3 });
  assert.deepEqual(config.bannedCheck, DEFAULTS.bannedCheck);
});

test('project config wins over global, found by walking up from cwd', () => {
  const dir = tmpdir();
  const globalFile = path.join(dir, 'config.json');
  fs.writeFileSync(globalFile, JSON.stringify({ reminder: { mode: 'tokens', everyTokens: 9000 } }));
  fs.writeFileSync(path.join(dir, '.just-say-so.json'), JSON.stringify({ reminder: { mode: 'prompts' } }));
  const nested = path.join(dir, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });

  const config = loadConfig(nested, { JUST_SAY_SO_CONFIG: globalFile });
  assert.deepEqual(config.reminder, { ...DEFAULTS.reminder, mode: 'prompts', everyTokens: 9000 });
});

test('arrays replace instead of merging', () => {
  const dir = tmpdir();
  fs.writeFileSync(
    path.join(dir, '.just-say-so.json'),
    JSON.stringify({ bannedCheck: { exclude: ['*.md'] } })
  );
  const config = loadConfig(dir, { JUST_SAY_SO_CONFIG: path.join(dir, 'nope.json') });
  assert.deepEqual(config.bannedCheck.exclude, ['*.md']);
});

test('malformed config files are ignored', () => {
  const dir = tmpdir();
  const globalFile = path.join(dir, 'config.json');
  fs.writeFileSync(globalFile, '{not json');
  assert.deepEqual(loadConfig(dir, { JUST_SAY_SO_CONFIG: globalFile }), DEFAULTS);
});
