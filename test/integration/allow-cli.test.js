import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Integration: the allow CLI's process contract — argv in, config file and
 * stdout/stderr/exit code out. The list-selection logic lives in
 * test/lib/allow.test.js.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'src', 'cli', 'allow.js');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

describe('allow CLI', () => {
  describe('when given a multiword term as separate args', () => {
    let cwd, result;

    beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-'));
      result = runCli(['robust', 'regression'], cwd);
    });

    it('should exit 0, report the add, and write the config', () => {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('added "robust regression" to allowPhrases');
      expect(JSON.parse(fs.readFileSync(path.join(cwd, '.just-say-so.json'), 'utf8'))).toEqual({
        bannedCheck: { allowPhrases: ['robust regression'] }
      });
    });
  });

  describe('when invoked with no term', () => {
    let result;

    beforeEach(() => {
      result = runCli([], fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-')));
    });

    it('should exit 1 with usage on stderr', () => {
      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 1,
        stderr: 'usage: allow.js <term or collocation>\n'
      });
    });
  });

  describe('when the existing config is malformed', () => {
    let cwd, result;

    beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-'));
      fs.writeFileSync(path.join(cwd, '.just-say-so.json'), '{oops');
      result = runCli(['robust'], cwd);
    });

    it('should exit 1 and leave the file untouched', () => {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('could not update config');
      expect(fs.readFileSync(path.join(cwd, '.just-say-so.json'), 'utf8')).toBe('{oops');
    });
  });
});
