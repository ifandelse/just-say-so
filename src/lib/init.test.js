import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { parseArgs, runInit } from './init.js';
import { packageUrl } from './vale-ini.js';
import { pluginVersion } from './version.js';

/*
 * Branch map — src/lib/init.js
 *   parseArgs: modes validated · --gh · repeated --mcp · --hook validated ·
 *     --dry-run · unknown argument
 *   repo root from git, cwd when git fails
 *   vale config: fresh file with the vocabulary created · existing file
 *     pinned/amended with the vocabulary created · already current ·
 *     absolute StylesPath resolved · empty Vocab line replaced in place
 *   vale sync: ran · missing binary · failed · dry run
 *   plugin config: nothing given · fresh · merged over existing · malformed
 *   hook: auto picks pre-commit > husky > git > pre-commit(no git: none) ·
 *     husky appends once · git writes once where `git rev-parse --git-path
 *     hooks` points (linked worktrees), reports an existing hook, reports
 *     when git cannot say · none · no .git
 */

function tmpdir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-init-')));
}

function tools({ git = true, sync = { status: 0 }, hooks = '.git/hooks' } = {}) {
  mockSpawnSync.mockImplementation((cmd, args) => {
    if (cmd === 'git') {
      if (!git) return { status: 128, stdout: '' };
      // git -C <cwd> rev-parse --show-toplevel | --git-path hooks
      return { status: 0, stdout: `${args.includes('--git-path') ? hooks : args[1]}\n` };
    }
    if (cmd === 'vale' && args[0] === 'sync') return sync;
    return { status: 0, stdout: '' };
  });
}

const URL = packageUrl(pluginVersion());

describe('init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseArgs', () => {
    it('should accept every flag and reject bad values', () => {
      expect(parseArgs(['--files', 'block', '--gh', '--mcp', 'a', '--mcp', 'b', '--reply', 'off', '--hook', 'git', '--dry-run'])).toEqual({
        opts: { files: 'block', gh: true, mcp: ['a', 'b'], reply: 'off', hook: 'git', dryRun: true },
        errors: []
      });
      expect(parseArgs(['--publish', 'loud', '--hook', 'cron', '--mcp']).errors).toEqual([
        '--publish takes off, warn, or block',
        '--hook takes auto, pre-commit, husky, git, none',
        '--mcp takes a tool-name pattern'
      ]);
      expect(parseArgs(['--what']).errors).toEqual(['unknown argument --what']);
    });
  });

  describe('when the repo has nothing yet and a package.json', () => {
    let root, result, hook;

    beforeEach(() => {
      root = tmpdir();
      fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      tools();
      result = runInit(root, ['--gh', '--reply', 'block', '--mcp', 'mcp__x__*'], {});
      hook = fs.readFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8');
    });

    it('should write every file, create the vocabulary, sync, and install the git hook', () => {
      expect(result.lines).toEqual([
        `project root: ${root}`,
        `wrote ${path.join(root, '.vale.ini')} with the JustSaySo package, StylesPath = styles, and Vocab = Project`,
        `created ${path.join(root, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt')}`,
        'ran vale sync',
        `wrote ${path.join(root, '.just-say-so.json')}: {"publish":{"gh":true,"mcp":["mcp__x__*"]},"reply":{"mode":"block"}}`,
        `commit gate: wrote ${path.join(root, '.git', 'hooks', 'pre-commit')}`,
        `commit gate: the gate comes from the dev dependency; run: npm install --save-dev github:ifandelse/just-say-so#v${pluginVersion()}`
      ]);
      expect(fs.readFileSync(path.join(root, '.vale.ini'), 'utf8')).toContain(`Packages = ${URL}\n\n[*]\nBasedOnStyles = JustSaySo, ai-tells, STE\n`);
      expect(JSON.parse(fs.readFileSync(path.join(root, '.just-say-so.json'), 'utf8'))).toEqual({
        publish: { gh: true, mcp: ['mcp__x__*'] },
        reply: { mode: 'block' }
      });
      expect(hook).toContain('node_modules/.bin/just-say-so-staged');
      expect(hook).toContain(`#v${pluginVersion()}`);
      expect(mockSpawnSync.mock.calls.find((c) => c[0] === 'vale')[2].cwd).toBe(root);
    });
  });

  describe('when run again over an existing setup with new flags', () => {
    let root, result;

    beforeEach(() => {
      root = tmpdir();
      fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
      fs.writeFileSync(path.join(root, '.vale.ini'), `MinAlertLevel = suggestion\nPackages = Microsoft, ${packageUrl('0.1.0')}\n[*]\nBasedOnStyles = Microsoft\n`);
      fs.writeFileSync(path.join(root, '.just-say-so.json'), JSON.stringify({ publish: { gh: true }, events: { mode: 'off' } }));
      tools();
      result = runInit(root, ['--files', 'block', '--hook', 'git'], {});
    });

    it('should re-pin the package, add the missing keys and vocabulary, merge the config, and leave the hook alone', () => {
      expect(result.lines).toEqual([
        `project root: ${root}`,
        `pinned the JustSaySo package at ${URL} in ${path.join(root, '.vale.ini')}`,
        `set StylesPath = styles in ${path.join(root, '.vale.ini')}`,
        `set Vocab = Project in ${path.join(root, '.vale.ini')}`,
        `created ${path.join(root, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt')}`,
        'ran vale sync',
        `updated ${path.join(root, '.just-say-so.json')}: {"files":{"mode":"block"}}`,
        `commit gate: ${path.join(root, '.git', 'hooks', 'pre-commit')} exists; add "node_modules/.bin/just-say-so-staged" to it by hand`,
        `commit gate: run: npm install --save-dev github:ifandelse/just-say-so#v${pluginVersion()}`
      ]);
      expect(fs.readFileSync(path.join(root, '.vale.ini'), 'utf8')).toBe(
        `MinAlertLevel = suggestion\nPackages = Microsoft, ${URL}\nStylesPath = styles\nVocab = Project\n[*]\nBasedOnStyles = Microsoft\n`
      );
      expect(JSON.parse(fs.readFileSync(path.join(root, '.just-say-so.json'), 'utf8'))).toEqual({
        publish: { gh: true },
        events: { mode: 'off' },
        files: { mode: 'block' }
      });
    });
  });

  describe('when the setup is current and the run is a dry run with Husky present', () => {
    let root, result, before;

    beforeEach(() => {
      root = tmpdir();
      fs.mkdirSync(path.join(root, '.git'));
      fs.mkdirSync(path.join(root, '.husky'));
      fs.writeFileSync(path.join(root, '.husky', 'pre-commit'), 'npm test\n');
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = styles\nVocab = Project\nPackages = ${URL}\n`);
      fs.mkdirSync(path.join(root, 'styles', 'config', 'vocabularies', 'Project'), { recursive: true });
      fs.writeFileSync(path.join(root, 'styles', 'config', 'vocabularies', 'Project', 'accept.txt'), '');
      before = fs.readFileSync(path.join(root, '.husky', 'pre-commit'), 'utf8');
      tools();
      result = runInit(root, ['--dry-run'], {});
    });

    it('should report without writing', () => {
      expect(result.lines).toEqual([
        `project root: ${root} (dry run, nothing written)`,
        `${path.join(root, '.vale.ini')} already loads the JustSaySo package at this version`,
        'would run vale sync',
        'no plugin settings given, so the defaults apply (files warn, publish block with no source, reply warn)',
        `commit gate: would add "node_modules/.bin/just-say-so-staged" to ${path.join(root, '.husky', 'pre-commit')}`,
        `commit gate: the gate comes from the dev dependency; run: npm install --save-dev github:ifandelse/just-say-so#v${pluginVersion()}`
      ]);
      expect(fs.readFileSync(path.join(root, '.husky', 'pre-commit'), 'utf8')).toBe(before);
      expect(fs.existsSync(path.join(root, '.just-say-so.json'))).toBe(false);
    });
  });

  describe('when Husky is used for real, twice', () => {
    let root, first, second, hook;

    beforeEach(() => {
      root = tmpdir();
      fs.mkdirSync(path.join(root, '.git'));
      fs.mkdirSync(path.join(root, '.husky'));
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = styles\nVocab = Project\nPackages = ${URL}\n`);
      tools();
      first = runInit(root, [], {}).lines;
      second = runInit(root, [], {}).lines;
      hook = fs.readFileSync(path.join(root, '.husky', 'pre-commit'), 'utf8');
    });

    it('should create the hook once and report it the second time', () => {
      expect(first).toContain(`commit gate: added "node_modules/.bin/just-say-so-staged" to ${path.join(root, '.husky', 'pre-commit')}`);
      expect(second).toContain(`commit gate: ${path.join(root, '.husky', 'pre-commit')} already runs the gate`);
      expect(hook).toBe('node_modules/.bin/just-say-so-staged\n');
    });
  });

  describe('when the pre-commit framework is used, or nothing is', () => {
    let framework, bare, none, noGit;

    beforeEach(() => {
      const a = tmpdir();
      fs.mkdirSync(path.join(a, '.git'));
      fs.writeFileSync(path.join(a, '.pre-commit-config.yaml'), 'repos: []\n');
      tools();
      framework = runInit(a, ['--dry-run'], {}).lines;
      const b = tmpdir();
      fs.mkdirSync(path.join(b, '.git'));
      bare = runInit(b, ['--dry-run'], {}).lines;
      none = runInit(b, ['--dry-run', '--hook', 'none'], {}).lines;
      const c = tmpdir();
      tools({ git: false });
      noGit = runInit(c, ['--dry-run', '--hook', 'git'], {}).lines;
    });

    it('should print the framework snippet, fall back to it without node, and skip when asked', () => {
      expect(framework.slice(-6)).toEqual([
        'commit gate: add this to .pre-commit-config.yaml and run pre-commit install:',
        '    repos:',
        '      - repo: https://github.com/ifandelse/just-say-so',
        `        rev: v${pluginVersion()}`,
        '        hooks:',
        '          - id: vale-staged'
      ]);
      expect(bare.find((l) => l.startsWith('commit gate:'))).toBe('commit gate: add this to .pre-commit-config.yaml (the file does not exist yet) and run pre-commit install:');
      expect(none.filter((l) => l.startsWith('commit gate'))).toEqual(['commit gate: skipped']);
      expect(noGit.filter((l) => l.startsWith('commit gate'))).toEqual(['commit gate: no .git here, nothing to install']);
    });
  });

  describe('when the config has an absolute StylesPath and an empty Vocab line', () => {
    let root, styles, result, ini;

    beforeEach(() => {
      root = tmpdir();
      styles = tmpdir();
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = ${styles}\nVocab =\nPackages = ${URL}\n[*]\nBasedOnStyles = JustSaySo\n`);
      tools();
      result = runInit(root, ['--hook', 'none'], {});
      ini = fs.readFileSync(path.join(root, '.vale.ini'), 'utf8');
    });

    it('should replace the empty key in place and create the vocabulary under the absolute path', () => {
      expect(result.lines.slice(1, 3)).toEqual([
        `set Vocab = Project in ${path.join(root, '.vale.ini')}`,
        `created ${path.join(styles, 'config', 'vocabularies', 'Project', 'accept.txt')}`
      ]);
      expect(ini).toBe(`StylesPath = ${styles}\nVocab = Project\nPackages = ${URL}\n[*]\nBasedOnStyles = JustSaySo\n`);
      expect(fs.existsSync(path.join(root, 'config'))).toBe(false);
    });
  });

  describe('when the checkout is a linked worktree whose hooks live elsewhere', () => {
    let root, hooks, result;

    beforeEach(() => {
      root = tmpdir();
      hooks = path.join(tmpdir(), 'main', '.git', 'hooks');
      fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = styles\nVocab = Project\nPackages = ${URL}\n`);
      tools({ hooks });
      result = runInit(root, [], {});
    });

    it('should write the hook where git says the hooks are', () => {
      expect(result.lines).toContain(`commit gate: wrote ${path.join(hooks, 'pre-commit')}`);
      expect(fs.existsSync(path.join(hooks, 'pre-commit'))).toBe(true);
    });
  });

  describe('when git cannot name the hooks directory', () => {
    let result;

    beforeEach(() => {
      const root = tmpdir();
      fs.mkdirSync(path.join(root, '.git'));
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = styles\nVocab = Project\nPackages = ${URL}\n`);
      mockSpawnSync.mockImplementation((cmd, args) => {
        if (cmd === 'git' && args.includes('--git-path')) return { status: 128, stdout: '' };
        if (cmd === 'git') return { status: 0, stdout: `${args[1]}\n` };
        return { status: 0, stdout: '' };
      });
      result = runInit(root, ['--hook', 'git'], {});
    });

    it('should say so and write nothing', () => {
      expect(result.lines.filter((l) => l.startsWith('commit gate'))).toEqual([
        'commit gate: git could not say where this checkout keeps its hooks; nothing written'
      ]);
    });
  });

  describe('when vale sync fails or vale is missing, or the config is malformed', () => {
    let failed, missing, malformed, thrown;

    beforeEach(() => {
      const root = tmpdir();
      fs.writeFileSync(path.join(root, '.vale.ini'), `StylesPath = styles\nVocab = Project\nPackages = ${URL}\n`);
      tools({ sync: { status: 1, stderr: 'E101 boom\n' } });
      failed = runInit(root, ['--hook', 'none'], {}).lines;
      tools({ sync: { error: new Error('ENOENT') } });
      missing = runInit(root, ['--hook', 'none'], {}).lines;
      fs.writeFileSync(path.join(root, '.just-say-so.json'), '{oops');
      tools();
      malformed = runInit(root, ['--hook', 'none', '--files', 'off'], {}).lines;
      try {
        runInit(root, ['--files', 'loud'], {});
      } catch (e) {
        thrown = e;
      }
    });

    it('should report each failure and throw only on bad arguments', () => {
      expect(failed).toContain('vale sync failed (exit 1): E101 boom');
      expect(missing).toContain('vale sync skipped: vale is not on PATH. Install it and run vale sync in the repo.');
      expect(malformed.some((l) => l.endsWith('is not valid JSON; fix it by hand and rerun'))).toBe(true);
      expect(thrown.message).toBe('--files takes off, warn, or block');
    });
  });
});
