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
      // Relative paths, as the /draft skill recommends, so the test fails
      // whenever a loader resolves them against the launch directory.
      fs.mkdirSync(path.join(b, 'rules'));
      fs.copyFileSync(path.join(ROOT, 'rules', 'manifest.json'), path.join(b, 'rules', 'manifest.json'));
      fs.writeFileSync(path.join(b, 'rules.json'), JSON.stringify({ sections: [{ title: 'B', rules: [{ id: 'domain-term', full: 'x', vale: ['Project.DomainTerm'] }] }] }));
      fs.writeFileSync(path.join(b, '.just-say-so.json'), JSON.stringify({ rules: { manifest: 'rules/manifest.json', extra: 'rules.json' } }));
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

  describe('when the advise and packages CLIs run with a styles directory, a cache, and the shipped registry', () => {
    let advise, adviseJson, packagesJson, pruned;

    beforeEach(() => {
      const sandbox = withFakeVale(makeSandbox());
      const project = fs.realpathSync(fs.mkdtempSync(path.join(sandbox.work, 'proj-')));
      const styles = path.join(project, 'styles');
      fs.mkdirSync(path.join(styles, 'ai-tells'), { recursive: true });
      fs.writeFileSync(path.join(styles, 'ai-tells', 'HedgingPhrases.yml'), "extends: existence\nmessage: \"AI hedge: '%s'. State your point directly.\"\nlevel: error\n");
      fs.writeFileSync(path.join(project, '.vale.ini'), 'StylesPath = styles\nPackages = ai-tells\n[*]\nBasedOnStyles = ai-tells\n');
      const lsConfig = path.join(sandbox.work, 'ls-config.json');
      fs.writeFileSync(lsConfig, JSON.stringify({ Formats: { reply: 'md', publish: 'md' }, GBaseStyles: ['ai-tells'], GChecks: {}, SBaseStyles: {}, SChecks: {}, RuleToLevel: {}, SLevels: {}, Paths: [styles], ConfigFiles: [] }));
      fs.mkdirSync(path.join(sandbox.stateDir, 'packages'), { recursive: true });
      fs.writeFileSync(
        path.join(sandbox.stateDir, 'packages', 'Voices.json'),
        JSON.stringify({ name: 'Voices', url: 'u', fetched: '2026-10-01T00:00:00.000Z', rules: [{ id: 'Direct.Hedging', level: 'warning', extends: 'existence', message: "Hedge: '%s'. State it.", description: null, link: null, sample: [] }] })
      );
      fs.writeFileSync(path.join(sandbox.stateDir, 'packages', 'Gone.json'), JSON.stringify({ name: 'Gone', url: 'u', fetched: '2026-10-01T00:00:00.000Z', rules: [] }));
      const rec = (i) => ({
        id: `2026-10-0${i}T12:00:00.000Z-000${i}`, session: 's', project, promptIndex: i + 1, sinceReminder: 0,
        reason: '#hedging stacked hedges again', tags: ['hedging'], rejected: { text: 'r', alerts: [] }, rewrite: null, version: '0.16.0'
      });
      fs.writeFileSync(path.join(sandbox.stateDir, 'rejections.jsonl'), [1, 2, 3].map((i) => JSON.stringify(rec(i))).join('\n') + '\n');
      const env = { ...sandbox.env, JSS_FAKE_LS_CONFIG: lsConfig, JUST_SAY_SO_REGISTRY: 'shipped' };
      const runEnv = (cli, args) => spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli', cli), ...args], { cwd: sandbox.work, encoding: 'utf8', env: { ...process.env, ...env } });
      advise = runEnv('advise.js', []);
      adviseJson = JSON.parse(runEnv('advise.js', ['--json']).stdout);
      packagesJson = JSON.parse(runEnv('packages.js', ['--json']).stdout);
      pruned = runEnv('packages.js', ['--prune']);
    });

    it('should shortlist the installed rule and the cached one, and read the config through vale', () => {
      expect(advise.status).toBe(0);
      expect(advise.stdout).toContain('package cache: 2 packages, 1 rules, fetched 2026-10-01T00:00:00.000Z.');
      expect(advise.stdout).toContain('· #hedging: 3 · uncovered: no bullet has this id.');
      expect(advise.stdout).toContain("ai-tells.HedgingPhrases [installed, on, error] 3 (hedge, hedging) · AI hedge: '%s'. State your point directly.");
      expect(advise.stdout).toContain("Direct.Hedging [cached from Voices, not installed] 3 (hedge, hedging) · Hedge: '%s'. State it.");
      expect(advise.stdout).toContain('registry: shipped copy (live fetch failed: JUST_SAY_SO_REGISTRY=shipped)');
      const p = adviseJson.projects[0];
      expect({ vale: p.vale, packages: p.packages, replyStyles: p.replyStyles, notInstalled: p.notInstalled.map((e) => e.name).includes('ai-tells') }).toEqual({
        vale: true, packages: ['ai-tells'], replyStyles: ['ai-tells'], notInstalled: false
      });
      expect(adviseJson.registry).toEqual({ source: 'shipped', error: 'JUST_SAY_SO_REGISTRY=shipped' });
    });

    it('should report the cache against the registry and prune what the registry dropped', () => {
      expect(packagesJson.packages.map((p) => [p.name, p.listed])).toEqual([['Gone', false], ['Voices', true]]);
      expect(packagesJson.missing.length).toBeGreaterThanOrEqual(20);
      expect(packagesJson.registry).toBe('shipped copy (live fetch failed: JUST_SAY_SO_REGISTRY=shipped)');
      expect(pruned.stdout).toMatch(/^removed Gone\n/);
      expect(pruned.stdout).toContain('  Voices: 1 rules · 2026-10-01T00:00:00.000Z\n');
      expect(pruned.stdout).not.toContain('Gone:');
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
