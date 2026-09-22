import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCheckArgs, checkTargets } from './check.js';
import { makeSandbox } from '../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/check.js
 *   parseCheckArgs: "--format <value>" · "--format" without value → error ·
 *                   "--format=<value>" · unknown flag → error · "-" kept as
 *                   target · invalid format value → error · no targets → error
 *   checkTargets:   "-" → stdin text, config from cwd · file read failure →
 *                   error status, exit 2 (beats exit 1) · exclude glob →
 *                   skipped · include non-empty: match → checked, no match →
 *                   skipped · glob base = project config dir when one exists,
 *                   cwd when none · config anchored on the file's directory
 *                   (disableWords honored) · hard violations → exit 1 ·
 *                   soft-only → report, exit 0 · clean → empty report, exit 0
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-check-'));
}

// Sandbox env with no global config file: the personal layer resolves to a
// path that does not exist, so only DEFAULTS + project config apply.
function isolatedEnv() {
  return makeSandbox().env;
}

describe('check', () => {
  describe('parseCheckArgs', () => {
    describe('when given files and no flags', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['a.md', '-']);
      });

      it('should default to text format and keep "-" as a target', () => {
        expect(result).toEqual({ targets: ['a.md', '-'], format: 'text', error: null });
      });
    });

    describe('when --format json is given as two args', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['--format', 'json', 'a.md']);
      });

      it('should parse the format', () => {
        expect(result).toEqual({ targets: ['a.md'], format: 'json', error: null });
      });
    });

    describe('when --format=text is given as one arg', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['--format=text', 'a.md']);
      });

      it('should parse the format', () => {
        expect(result).toEqual({ targets: ['a.md'], format: 'text', error: null });
      });
    });

    describe('when --format has no value', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['a.md', '--format']);
      });

      it('should report the missing value', () => {
        expect(result).toEqual({ error: '--format needs a value' });
      });
    });

    describe('when the format value is not text or json', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['--format', 'yaml', 'a.md']);
      });

      it('should report the unknown format', () => {
        expect(result).toEqual({ error: 'unknown format "yaml"' });
      });
    });

    describe('when an unknown option appears', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['--nope', 'a.md']);
      });

      it('should report the option', () => {
        expect(result).toEqual({ error: 'unknown option --nope' });
      });
    });

    describe('when no targets remain', () => {
      let result;

      beforeEach(() => {
        result = parseCheckArgs(['--format', 'json']);
      });

      it('should report that no files were given', () => {
        expect(result).toEqual({ error: 'no files given' });
      });
    });
  });

  describe('checkTargets', () => {
    describe('when stdin carries a banned word', () => {
      let outcome;

      beforeEach(() => {
        outcome = checkTargets(['-'], {
          cwd: tmpdir(),
          env: isolatedEnv(),
          stdinText: 'a robust plan'
        });
      });

      it('should check the stdin text and exit 1', () => {
        expect(outcome.exitCode).toBe(1);
        expect(outcome.results).toEqual([
          expect.objectContaining({
            path: '-',
            status: 'checked',
            hard: [expect.objectContaining({ term: 'robust', count: 1 })]
          })
        ]);
      });
    });

    describe('when a file is clean', () => {
      let outcome;

      beforeEach(() => {
        const cwd = tmpdir();
        fs.writeFileSync(path.join(cwd, 'clean.md'), 'plain words about the scheduler');
        outcome = checkTargets(['clean.md'], { cwd, env: isolatedEnv() });
      });

      it('should return an empty report and exit 0', () => {
        expect(outcome).toEqual({
          results: [{ path: 'clean.md', status: 'checked', hard: [], soft: [], report: '' }],
          exitCode: 0
        });
      });
    });

    describe('when a file has only advisory terms', () => {
      let outcome;

      beforeEach(() => {
        const cwd = tmpdir();
        fs.writeFileSync(path.join(cwd, 'soft.md'), 'this is very fast');
        outcome = checkTargets(['soft.md'], { cwd, env: isolatedEnv() });
      });

      it('should report the advisory but exit 0', () => {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.results[0].soft).toEqual([
          expect.objectContaining({ term: 'very', count: 1 })
        ]);
        expect(outcome.results[0].report).toContain('"very" ×1');
      });
    });

    describe('when a file cannot be read alongside one with violations', () => {
      let outcome;

      beforeEach(() => {
        const cwd = tmpdir();
        fs.writeFileSync(path.join(cwd, 'bad.md'), 'a robust plan');
        outcome = checkTargets(['missing.md', 'bad.md'], { cwd, env: isolatedEnv() });
      });

      it('should mark the missing file as an error and exit 2 over 1', () => {
        expect(outcome.exitCode).toBe(2);
        expect(outcome.results[0].status).toBe('error');
        expect(outcome.results[0].message).toContain('ENOENT');
        expect(outcome.results[1].status).toBe('checked');
      });
    });

    describe('when the project config excludes the file with a relative glob', () => {
      let outcome;

      beforeEach(() => {
        const root = tmpdir();
        fs.writeFileSync(
          path.join(root, '.just-say-so.json'),
          JSON.stringify({ bannedCheck: { exclude: ['docs/**'] } })
        );
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'x.md'), 'a robust plan');
        // cwd far from the project proves the glob measures from the config dir
        outcome = checkTargets([path.join(root, 'docs', 'x.md')], {
          cwd: tmpdir(),
          env: isolatedEnv()
        });
      });

      it('should skip the file and exit 0', () => {
        expect(outcome).toEqual({
          results: [{ path: expect.stringContaining('x.md'), status: 'skipped' }],
          exitCode: 0
        });
      });
    });

    describe('when include is non-empty and only one file matches', () => {
      let outcome, root;

      beforeEach(() => {
        root = tmpdir();
        fs.writeFileSync(
          path.join(root, '.just-say-so.json'),
          JSON.stringify({ bannedCheck: { include: ['docs/**'] } })
        );
        fs.mkdirSync(path.join(root, 'docs'));
        fs.mkdirSync(path.join(root, 'other'));
        fs.writeFileSync(path.join(root, 'docs', 'in.md'), 'a robust plan');
        fs.writeFileSync(path.join(root, 'other', 'out.md'), 'a robust plan');
        outcome = checkTargets(['docs/in.md', 'other/out.md'], {
          cwd: root,
          env: isolatedEnv()
        });
      });

      it('should check the included file and skip the other', () => {
        expect(outcome.exitCode).toBe(1);
        expect(outcome.results.map((r) => ({ path: r.path, status: r.status }))).toEqual([
          { path: 'docs/in.md', status: 'checked' },
          { path: 'other/out.md', status: 'skipped' }
        ]);
      });
    });

    describe('when there is no project config and the personal config excludes by relative glob', () => {
      let outcome;

      beforeEach(() => {
        const cwd = tmpdir();
        fs.mkdirSync(path.join(cwd, 'sub'));
        fs.writeFileSync(path.join(cwd, 'sub', 'x.md'), 'a robust plan');
        const sandbox = makeSandbox({ bannedCheck: { exclude: ['sub/**'] } });
        outcome = checkTargets(['sub/x.md'], { cwd, env: sandbox.env });
      });

      it('should measure the glob from cwd and skip the file', () => {
        expect(outcome).toEqual({
          results: [{ path: 'sub/x.md', status: 'skipped' }],
          exitCode: 0
        });
      });
    });

    describe('when the config next to the file disables the matched word', () => {
      let outcome;

      beforeEach(() => {
        const root = tmpdir();
        fs.writeFileSync(
          path.join(root, '.just-say-so.json'),
          JSON.stringify({ bannedCheck: { disableWords: ['robust'] } })
        );
        fs.mkdirSync(path.join(root, 'a'));
        fs.writeFileSync(path.join(root, 'a', 'doc.md'), 'a robust plan');
        // cwd elsewhere proves config anchors on the file's directory
        outcome = checkTargets([path.join(root, 'a', 'doc.md')], {
          cwd: tmpdir(),
          env: isolatedEnv()
        });
      });

      it('should find nothing and exit 0', () => {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.results[0]).toEqual(
          expect.objectContaining({ status: 'checked', hard: [] })
        );
      });
    });
  });
});
