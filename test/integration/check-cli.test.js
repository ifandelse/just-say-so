import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Integration: the check CLI's process contract — argv/stdin in, report and
 * exit code out. The scan and config-resolution logic lives in
 * src/lib/check.test.js.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'src', 'cli', 'check.js');

function runCli(args, cwd, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    // point the personal-config layer at a file that does not exist, so the
    // developer's real config never leaks into the test
    env: { ...process.env, JUST_SAY_SO_CONFIG: path.join(cwd, 'no-such-config.json') }
  });
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-check-cli-'));
}

describe('check CLI', () => {
  describe('when a file contains a banned word', () => {
    let result;

    beforeEach(() => {
      const cwd = tmpdir();
      fs.writeFileSync(path.join(cwd, 'draft.md'), 'a robust plan');
      result = runCli(['draft.md'], cwd);
    });

    it('should exit 1 and print the file report', () => {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('draft.md');
      expect(result.stdout).toContain('"robust" ×1');
    });
  });

  describe('when stdin is clean', () => {
    let result;

    beforeEach(() => {
      result = runCli(['-'], tmpdir(), 'plain words about the scheduler');
    });

    it('should exit 0 with no output', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({
        status: 0,
        stdout: ''
      });
    });
  });

  describe('when --format json is given', () => {
    let result, parsed;

    beforeEach(() => {
      const cwd = tmpdir();
      fs.writeFileSync(path.join(cwd, 'draft.md'), 'a robust plan');
      result = runCli(['--format', 'json', 'draft.md'], cwd);
      parsed = JSON.parse(result.stdout);
    });

    it('should exit 1 and emit the structured result without the text report', () => {
      expect(result.status).toBe(1);
      expect(parsed.files).toEqual([
        {
          path: 'draft.md',
          status: 'checked',
          hard: [expect.objectContaining({ term: 'robust', count: 1 })],
          soft: []
        }
      ]);
    });
  });

  describe('when given an unknown option', () => {
    let result;

    beforeEach(() => {
      result = runCli(['--nope', 'draft.md'], tmpdir());
    });

    it('should exit 2 with usage on stderr', () => {
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('unknown option --nope');
      expect(result.stderr).toContain('usage: check.js');
    });
  });
});
