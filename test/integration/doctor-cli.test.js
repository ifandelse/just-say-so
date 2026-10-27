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

  describe('when the undescribed CLI runs with the fake vale', () => {
    let result, json;

    beforeEach(() => {
      const sandbox = withFakeVale(makeSandbox());
      result = run('undescribed.js', [], sandbox);
      json = run('undescribed.js', ['--json'], sandbox);
    });

    it('should report nothing to draft and print an empty list as JSON', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({
        status: 0,
        stdout: 'just-say-so: every enabled rule at error level or above already has a bullet. Nothing to draft.\n'
      });
      expect(JSON.parse(json.stdout)).toEqual([]);
    });
  });

  describe('when the summary CLI runs on an empty state directory', () => {
    let result, json, bad;

    beforeEach(() => {
      const sandbox = makeSandbox();
      result = run('summary.js', [], sandbox);
      json = run('summary.js', ['--json', '--since', '30d'], sandbox);
      bad = run('summary.js', ['--since', 'yesterday'], sandbox);
    });

    it('should say there are no records, print the object as JSON, and reject a bad span', () => {
      expect({ status: result.status, stdout: result.stdout }).toEqual({
        status: 0,
        stdout: 'just-say-so summary\n\nNo records in the window. The events log and the rejections file are empty, missing, or outside the window.\n'
      });
      expect(JSON.parse(json.stdout).volume.turns).toBe(0);
      expect({ status: bad.status, stderr: bad.stderr }).toEqual({
        status: 1,
        stderr: 'just-say-so summary: --since takes an ISO date or a span such as 30d or 6w, not yesterday\n'
      });
    });
  });

  describe('when the summary runs from one project about another with its own rules.extra', () => {
    let fromA, fromB;

    beforeEach(() => {
      const shared = makeSandbox();
      const a = fs.realpathSync(fs.mkdtempSync(path.join(shared.work, 'a-')));
      const b = fs.realpathSync(fs.mkdtempSync(path.join(shared.work, 'b-')));
      fs.writeFileSync(path.join(b, 'rules.json'), JSON.stringify({ sections: [{ title: 'B', rules: [{ id: 'domain-term', full: 'x', vale: ['Project.DomainTerm'] }] }] }));
      fs.writeFileSync(path.join(b, '.just-say-so.json'), JSON.stringify({ rules: { extra: path.join(b, 'rules.json') } }));
      fs.mkdirSync(shared.stateDir, { recursive: true });
      fs.writeFileSync(
        path.join(shared.stateDir, 'rejections.jsonl'),
        JSON.stringify({
          id: '2026-10-01T12:00:00.000Z-abcd',
          session: 's',
          project: b,
          promptIndex: 2,
          sinceReminder: 0,
          reason: '#domain-term',
          tags: ['domain-term'],
          rejected: { text: 'r', alerts: [{ check: 'Project.DomainTerm', severity: 'error', line: 1, match: 'q', message: 'm' }] },
          rewrite: null,
          version: '0.15.0'
        }) + '\n'
      );
      const runIn = (cwd) => spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli', 'summary.js'), '--json', '--project', b], { cwd, encoding: 'utf8', env: { ...process.env, ...shared.env } });
      fromA = JSON.parse(runIn(a).stdout).tags;
      fromB = JSON.parse(runIn(b).stdout).tags;
    });

    it('should classify the tag by the reported project, wherever the command runs', () => {
      const expected = [{ tag: 'domain-term', count: 1, fired: 1, linted: 1, covers: 'vale', rules: ['Project.DomainTerm'], projects: expect.any(Array) }];
      expect(fromA).toEqual(expected);
      expect(fromB).toEqual(expected);
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
