import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, withFakeVale } from '../helpers/sandbox.js';

/*
 * Integration: the doctor and init CLIs' process contracts — exit codes and
 * the report shape — with the fake vale on PATH. The facts and warnings
 * themselves are covered in src/lib/doctor.test.js and init.test.js.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(cli, args, sandbox) {
  return spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli', cli), ...args], {
    cwd: sandbox.work,
    encoding: 'utf8',
    env: { ...process.env, ...sandbox.env }
  });
}

describe('doctor and init CLIs', () => {
  describe('when the doctor runs on a directory with no .vale.ini', () => {
    let result;

    beforeEach(() => {
      result = run('doctor.js', [], withFakeVale(makeSandbox()));
    });

    it('should print the report and exit 1 for the fallback warning', () => {
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/^just-say-so doctor — plugin [\d.]+\n/);
      expect(result.stdout).toContain('vale: 0.0.0-fake (errata-ai)');
      expect(result.stdout).toContain('Warnings (');
      expect(result.stdout).toContain('No .vale.ini above this directory');
    });
  });

  describe('when init runs with a bad argument', () => {
    let result;

    beforeEach(() => {
      result = run('init.js', ['--files', 'loud'], withFakeVale(makeSandbox()));
    });

    it('should exit 1 with the reason and the usage', () => {
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('just-say-so init: --files takes off, warn, or block\nusage: init.js [--files MODE] [--publish MODE] [--gh] [--mcp PATTERN]... [--reply MODE] [--hook auto|pre-commit|husky|git|none] [--dry-run]\n');
    });
  });

  describe('when init runs for real in a bare directory', () => {
    let sandbox, result;

    beforeEach(() => {
      sandbox = withFakeVale(makeSandbox());
      result = run('init.js', ['--hook', 'none', '--reply', 'off'], sandbox);
    });

    it('should write the files, then print the doctor report', () => {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`just-say-so init: wrote ${fs.realpathSync(sandbox.work)}${path.sep}.vale.ini`);
      expect(result.stdout).toContain('just-say-so init: ran vale sync');
      expect(result.stdout).toContain('just-say-so doctor — plugin');
      expect(fs.existsSync(path.join(sandbox.work, '.vale.ini'))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(sandbox.work, '.just-say-so.json'), 'utf8'))).toEqual({ reply: { mode: 'off' } });
    });
  });
});
