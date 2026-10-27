import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Integration: the allow CLI's process contract — argv in, vocabulary file
 * and stdout/stderr/exit code out. The ini editing lives in
 * src/lib/allow.test.js.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'src', 'cli', 'allow.js');

// The CLI logs an allow event, so it gets a throwaway state directory and
// an empty personal config, never the developer's own.
function runCli(args, cwd) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-state-'));
  const env = { ...process.env, JUST_SAY_SO_STATE_DIR: state, JUST_SAY_SO_CONFIG: path.join(state, 'none.json') };
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });
}

describe('allow CLI', () => {
  describe('when given a multiword term as separate args and the ini lacks a Vocab', () => {
    let cwd, result, acceptFile;

    beforeEach(() => {
      cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-')));
      fs.writeFileSync(path.join(cwd, '.vale.ini'), 'StylesPath = styles\n');
      acceptFile = path.join(cwd, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt');
      result = runCli(['robust', 'regression'], cwd);
    });

    it('should exit 0, report both writes, and create the vocabulary', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({
        status: 0,
        stdout: `just-say-so: added "robust regression" to the Vale vocabulary (${acceptFile})\njust-say-so: added StylesPath/Vocab to ${path.join(cwd, '.vale.ini')}\n`
      });
      expect(fs.readFileSync(acceptFile, 'utf8')).toBe('robust regression\n');
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

  describe('when no .vale.ini exists', () => {
    let cwd, result;

    beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cli-'));
      result = runCli(['robust'], cwd);
    });

    it('should exit 1 and say what to add', () => {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('could not add the term: no .vale.ini above');
      expect(fs.readdirSync(cwd)).toEqual([]);
    });
  });
});
