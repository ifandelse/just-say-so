import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox, withFakeVale } from '../helpers/sandbox.js';

/*
 * Integration: the staged-check CLI's process contract against a real git
 * repository — staged index content in, report and exit code out. The
 * hunk parsing and alert filtering live in src/lib/check-staged.test.js.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'src', 'cli', 'check-staged.js');

function runGit(args, cwd) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...args], {
    cwd,
    encoding: 'utf8'
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo(sandbox) {
  const repo = path.join(sandbox.work, 'repo');
  fs.mkdirSync(repo);
  runGit(['init', '-q', '-b', 'main'], repo);
  // A committed legacy file whose banned term must never block a commit
  // that leaves its line alone.
  fs.writeFileSync(path.join(repo, 'doc.md'), 'we leverage nothing here\nsecond line\n');
  runGit(['add', 'doc.md'], repo);
  runGit(['commit', '-q', '-m', 'seed'], repo);
  return repo;
}

function runCli(args, repo, env) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('check-staged CLI', () => {
  let sandbox, repo;

  beforeEach(() => {
    sandbox = withFakeVale(makeSandbox());
    repo = makeRepo(sandbox);
  });

  describe('when a staged edit adds a banned term', () => {
    let result;

    beforeEach(() => {
      fs.appendFileSync(path.join(repo, 'doc.md'), 'now with synergy\n');
      runGit(['add', 'doc.md'], repo);
      result = runCli([], repo, sandbox.env);
    });

    it('should exit 1 and report the added line only', () => {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('doc.md');
      expect(result.stdout).toContain('L3');
      // the legacy "leverage" on line 1 is not this commit's problem
      expect(result.stdout).not.toContain('L1');
      expect(result.stderr).toContain('JUST_SAY_SO_PRECOMMIT=0');
    });
  });

  describe('when the staged edit leaves legacy alerts alone', () => {
    it('should exit 0', () => {
      fs.appendFileSync(path.join(repo, 'doc.md'), 'a perfectly clean line\n');
      runGit(['add', 'doc.md'], repo);
      const result = runCli([], repo, sandbox.env);
      expect(result.status).toBe(0);
    });
  });

  describe('when the banned term is only in the working tree, not the index', () => {
    it('should judge the staged content and exit 0', () => {
      fs.appendFileSync(path.join(repo, 'doc.md'), 'a perfectly clean line\n');
      runGit(['add', 'doc.md'], repo);
      // dirty the working tree after staging; the commit will not contain this
      fs.appendFileSync(path.join(repo, 'doc.md'), 'unstaged synergy\n');
      const result = runCli([], repo, sandbox.env);
      expect(result.status).toBe(0);
    });
  });

  describe('when nothing markdown is staged', () => {
    it('should exit 0 quietly', () => {
      const result = runCli([], repo, sandbox.env);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('');
    });
  });

  describe('when JUST_SAY_SO_PRECOMMIT=0', () => {
    it('should skip the check and say so', () => {
      fs.appendFileSync(path.join(repo, 'doc.md'), 'now with synergy\n');
      runGit(['add', 'doc.md'], repo);
      const result = runCli([], repo, { ...sandbox.env, JUST_SAY_SO_PRECOMMIT: '0' });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('skipped');
    });
  });

  describe('when --base checks a branch', () => {
    let result;

    beforeEach(() => {
      runGit(['checkout', '-q', '-b', 'feature'], repo);
      fs.appendFileSync(path.join(repo, 'doc.md'), 'branch adds synergy\n');
      runGit(['add', 'doc.md'], repo);
      runGit(['commit', '-q', '-m', 'branch work'], repo);
      result = runCli(['--base', 'main'], repo, sandbox.env);
    });

    it('should exit 1 on the line the branch added', () => {
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('L3');
      expect(result.stdout).not.toContain('L1');
    });
  });

  describe('when given unknown arguments', () => {
    it('should exit 2 with usage', () => {
      const result = runCli(['--what'], repo, sandbox.env);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage');
    });
  });
});
