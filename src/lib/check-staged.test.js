import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runStagedCheck,
  parseAddedLines,
  isWholeFileRule,
  fileLevelRules,
  stylesDirFor,
  selectAlerts
} from './check-staged.js';

describe('parseAddedLines', () => {
  it('should map each file to the lines its hunks add', () => {
    const diff = [
      'diff --git a/docs/a.md b/docs/a.md',
      'index 123..456 100644',
      '--- a/docs/a.md',
      '+++ b/docs/a.md',
      '@@ -4,0 +5,3 @@',
      '+one',
      '+two',
      '+three',
      '@@ -20 +23 @@',
      '-old',
      '+new',
      'diff --git a/b.md b/b.md',
      '@@ -1,2 +1,0 @@',
      '-gone',
      '-gone too'
    ].join('\n');
    const added = parseAddedLines(diff);
    expect([...added.get('docs/a.md')].sort((x, y) => x - y)).toEqual([5, 6, 7, 23]);
    // a deletion-only hunk (+1,0) adds no lines, but the file still appears
    expect([...added.get('b.md')]).toEqual([]);
  });

  it('should attribute a rename to the destination path', () => {
    const diff = [
      'diff --git a/old.md b/new.md',
      'similarity index 90%',
      'rename from old.md',
      'rename to new.md',
      '@@ -3,0 +4 @@',
      '+added here'
    ].join('\n');
    const added = parseAddedLines(diff);
    expect(added.has('new.md')).toBe(true);
    expect([...added.get('new.md')]).toEqual([4]);
    expect(added.has('old.md')).toBe(false);
  });

  it('should default a hunk with no count to one line', () => {
    const added = parseAddedLines('diff --git a/x.md b/x.md\n@@ -0,0 +1 @@\n+only');
    expect([...added.get('x.md')]).toEqual([1]);
  });
});

describe('isWholeFileRule', () => {
  it('should treat metric rules as whole-file', () => {
    expect(isWholeFileRule('extends: metric\nmessage: too long')).toBe(true);
  });

  it('should treat document-scoped occurrence rules as whole-file', () => {
    expect(isWholeFileRule("extends: occurrence\nscope: summary")).toBe(true);
    expect(isWholeFileRule("extends: occurrence\nscope: 'raw'")).toBe(true);
    expect(isWholeFileRule('extends: occurrence\nscope: doc(heading)')).toBe(true);
  });

  it('should keep sentence-scoped occurrence and existence rules line-anchored', () => {
    expect(isWholeFileRule('extends: occurrence\nscope: sentence')).toBe(false);
    expect(isWholeFileRule('extends: existence\ntokens: [robust]')).toBe(false);
    expect(isWholeFileRule('message: no extends line at all')).toBe(false);
  });
});

describe('fileLevelRules', () => {
  let styles;

  beforeEach(() => {
    styles = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-styles-'));
    const write = (rel, text) => {
      const full = path.join(styles, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    };
    write('House/Metric.yml', 'extends: metric\nmessage: m');
    write('House/sub/DocWide.yml', 'extends: occurrence\nscope: summary');
    write('House/Anchored.yml', 'extends: existence\ntokens: [x]');
    write('config/vocabularies/X/accept.txt', 'term');
  });

  afterEach(() => {
    fs.rmSync(styles, { recursive: true, force: true });
  });

  it('should name whole-file rules with Vale nested-rule dotting and skip config', () => {
    expect(fileLevelRules(styles)).toEqual(new Set(['House.Metric', 'House.sub.DocWide']));
  });

  it('should return an empty set for a missing styles directory', () => {
    expect(fileLevelRules(path.join(styles, 'nope'))).toEqual(new Set());
  });
});

describe('stylesDirFor', () => {
  it('should resolve StylesPath relative to the config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-ini-'));
    const ini = path.join(dir, '.vale.ini');
    fs.writeFileSync(ini, 'StylesPath = .vale/styles\nMinAlertLevel = suggestion\n');
    expect(stylesDirFor(ini)).toBe(path.join(dir, '.vale', 'styles'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should return null when the config cannot be read', () => {
    expect(stylesDirFor(path.join(os.tmpdir(), 'no-such-dir', '.vale.ini'))).toBeNull();
  });

  it('should return null when the config has no StylesPath', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-ini-'));
    const ini = path.join(dir, '.vale.ini');
    fs.writeFileSync(ini, 'MinAlertLevel = suggestion\n');
    expect(stylesDirFor(ini)).toBe(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('selectAlerts', () => {
  const alert = (line, check = 'JustSaySo.Buzzwords') => ({
    Line: line,
    Check: check,
    Severity: 'error',
    Match: 'x',
    file: 'a.md'
  });

  it('should keep alerts on added lines and drop the rest', () => {
    const alerts = new Map([['a.md', [alert(3), alert(9)]]]);
    const added = new Map([['a.md', new Set([3])]]);
    const { kept, unmapped } = selectAlerts(alerts, added, new Set());
    expect(kept.get('a.md').map((a) => a.Line)).toEqual([3]);
    expect(unmapped).toEqual([]);
  });

  it('should keep whole-file rules on any line of a changed file', () => {
    const alerts = new Map([['a.md', [alert(1, 'House.Metric'), alert(9)]]]);
    const added = new Map([['a.md', new Set([400])]]);
    const { kept } = selectAlerts(alerts, added, new Set(['House.Metric']));
    expect(kept.get('a.md').map((a) => a.Check)).toEqual(['House.Metric']);
  });

  it('should report paths Vale saw that the diff never mentioned', () => {
    const alerts = new Map([['elsewhere.md', [alert(1)]]]);
    const added = new Map([['a.md', new Set([1])]]);
    const { kept, unmapped } = selectAlerts(alerts, added, new Set());
    expect(unmapped).toEqual(['elsewhere.md']);
    expect(kept.has('elsewhere.md')).toBe(false);
  });

  it('should keep everything when there is no diff to filter by', () => {
    const alerts = new Map([['a.md', [alert(3), alert(9)]]]);
    const { kept, unmapped } = selectAlerts(alerts, null, new Set());
    expect(kept.get('a.md')).toHaveLength(2);
    expect(unmapped).toEqual([]);
  });
});

// runStagedCheck drives git and vale as child processes, so these cases run
// against a real temporary repository and a vale stand-in on PATH. The
// stand-in answers `ls-dirs` (the probe) and reports an error alert on
// every line of the named file that contains "forbidden", with that
// line's number, which is the number the line filter must match.
describe('runStagedCheck', () => {
  let repo, env;

  const sh = (args) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: repo,
      encoding: 'utf8'
    });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);
  const errorLines = (result) =>
    result.report
      .split('\n')
      .filter((l) => l.includes('Test.Banned'))
      .map((l) => parseInt(/L(\d+):/.exec(l)[1], 10));

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-repo-')));
    const bin = path.join(repo, '.bin');
    fs.mkdirSync(bin);
    const fake = path.join(bin, 'vale');
    fs.writeFileSync(
      fake,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const args = process.argv.slice(2);',
        "if (args[0] === 'ls-dirs') process.exit(0);",
        "if (process.env.JSS_TEST_VALE_FAIL) { process.stderr.write('E_COLD_CALZONE'); process.exit(2); }",
        "if (process.env.JSS_TEST_VALE_GARBAGE) { process.stdout.write('not json'); process.exit(0); }",
        'const file = args[args.length - 1];',
        // Stand in for a Vale that found the file git named: one alert, no read.
        "if (process.env.JSS_TEST_VALE_ALWAYS) { process.stdout.write(JSON.stringify({ [file]: [{ Check: 'Test.Banned', Severity: 'error', Line: 1, Span: [1, 9], Match: 'forbidden', Message: 'banned' }] })); process.exit(1); }",
        "if (process.env.JSS_TEST_VALE_EMPTY) { process.stdout.write(JSON.stringify({ [file]: [], note: 'nothing' })); process.exit(0); }",
        "const lines = fs.readFileSync(file, 'utf8').split('\\n');",
        'const alerts = [];',
        'lines.forEach((text, i) => {',
        "  const col = text.indexOf('forbidden');",
        '  if (col === -1) return;',
        "  alerts.push({ Check: 'Test.Banned', Severity: 'error', Line: i + 1, Span: [col + 1, col + 9],",
        "    Match: 'forbidden', Message: 'banned' });",
        '});',
        // Vale on Windows prints the path with backslashes.
        "const key = process.env.JSS_TEST_VALE_SEP ? file.split('/').join(process.env.JSS_TEST_VALE_SEP) : file;",
        'process.stdout.write(JSON.stringify(alerts.length ? { [key]: alerts } : {}));',
        'process.exit(alerts.length ? 1 : 0);'
      ].join('\n')
    );
    fs.chmodSync(fake, 0o755);
    // The developer's own config layers and skip flag must not reach the gate.
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    env.JUST_SAY_SO_CONFIG = path.join(repo, 'no-such-config.json');
    delete env.JUST_SAY_SO_FORCE_CONFIG;
    delete env.JUST_SAY_SO_PRECOMMIT;

    sh(['init', '-q', '-b', 'main']);
    write('.vale.ini', 'StylesPath = styles\n\n[*.md]\nBasedOnStyles = Test\n');
    write('.gitignore', '.bin\n');
    write('doc.md', '# Doc\n\nClean.\n');
    sh(['add', '-A']);
    sh(['commit', '-qm', 'base']);
    sh(['checkout', '-qb', 'feature']);
    write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n');
    sh(['commit', '-qam', 'add an error']);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('in --base mode', () => {
    describe('when the working tree matches HEAD', () => {
      let result;

      beforeEach(() => {
        result = runStagedCheck({ base: 'main', cwd: repo, env });
      });

      it('should fail on the committed error at its line', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([5]);
      });
    });

    describe('when uncommitted lines sit above the committed error', () => {
      let result;

      beforeEach(() => {
        write('doc.md', 'An uncommitted line.\n\n# Doc\n\nClean.\n\nA forbidden line the branch committed.\n');
        result = runStagedCheck({ base: 'main', cwd: repo, env });
      });

      it('should still fail, at the working-tree line', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([7]);
      });
    });

    describe('when the base is HEAD and an uncommitted line has the error', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nAnother forbidden line, uncommitted.\n');
        result = runStagedCheck({ base: 'HEAD', cwd: repo, env });
      });

      it('should report only the uncommitted line', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([7]);
      });
    });

    describe('when an untracked prose file has an error', () => {
      let result;

      beforeEach(() => {
        write('new.md', 'Untracked forbidden text.\n');
        result = runStagedCheck({ base: 'main', cwd: repo, env });
      });

      it('should count every line of the file as added', () => {
        expect(result.exitCode).toBe(1);
        expect(result.report).toContain('new.md');
        expect(result.notices).toEqual([expect.stringContaining('error-level alerts on added lines')]);
      });
    });

describe('when git quotes a path and Vale reports it under that spelling', () => {
      let result;

      beforeEach(() => {
        // git prints a non-ASCII name as "caf\\303\\251.md", quotes included,
        // and the diff header carries the same escape without the quotes.
        write('café.md', 'A forbidden line.\n');
        sh(['add', 'café.md']);
        sh(['commit', '-qm', 'add a quoted path']);
        result = runStagedCheck({ base: 'main', cwd: repo, env: { ...env, JSS_TEST_VALE_ALWAYS: '1' } });
      });

      it('should refuse to judge the file rather than drop its alerts', () => {
        expect(result.exitCode).toBe(2);
        expect(result.notices).toEqual(['just-say-so: Vale and git disagree about these paths: "caf\\303\\251.md"']);
      });
    });

    describe('when the branch changed no prose', () => {
      let result;

      beforeEach(() => {
        sh(['checkout', '-q', 'main']);
        result = runStagedCheck({ base: 'main', cwd: repo, env });
      });

      it('should pass with no report', () => {
        expect(result).toEqual({ exitCode: 0, report: '', notices: [] });
      });
    });
  });

  describe('in staged mode', () => {
    describe('when the staged content has an error', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nStaged forbidden line.\n');
        sh(['add', 'doc.md']);
        // A later unstaged edit must not move the staged line numbers.
        write('doc.md', 'Unstaged.\n# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nStaged forbidden line.\n');
        result = runStagedCheck({ cwd: repo, env });
      });

      it('should fail on the staged line only', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([7]);
      });
    });

    describe('when Vale prints a staged path with backslashes, as it does on Windows', () => {
      let result;

      beforeEach(() => {
        fs.mkdirSync(path.join(repo, 'docs'));
        write('docs/guide.md', '# Guide\n\nStaged forbidden line.\n');
        sh(['add', 'docs/guide.md']);
        result = runStagedCheck({ cwd: repo, env: { ...env, JSS_TEST_VALE_SEP: '\\' } });
      });

      it('should report the alert under git\'s path', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([3]);
        expect(result.report).toContain('docs/guide.md');
        expect(result.notices).toEqual([expect.stringContaining('error-level alerts on added lines')]);
      });
    });

    describe('when two staged lines have errors', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nStaged forbidden one.\n\nStaged forbidden two.\n');
        sh(['add', 'doc.md']);
        result = runStagedCheck({ cwd: repo, env });
      });

      it('should list both in line order and count them', () => {
        expect(result.exitCode).toBe(1);
        expect(errorLines(result)).toEqual([7, 9]);
        expect(result.report).toContain('Totals: 2 error(s), 0 warning(s), 0 suggestion(s) across 1 file(s).');
      });
    });

    describe('when the staged prose is clean', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nA clean staged line.\n');
        sh(['add', 'doc.md']);
        result = runStagedCheck({ cwd: repo, env });
      });

      it('should pass with no report', () => {
        expect(result).toEqual({ exitCode: 0, report: '', notices: [] });
      });
    });

    describe('when nothing prose is staged', () => {
      let result;

      beforeEach(() => {
        write('notes.txt', 'forbidden but not prose\n');
        sh(['add', 'notes.txt']);
        result = runStagedCheck({ cwd: repo, env });
      });

      it('should pass with no report', () => {
        expect(result).toEqual({ exitCode: 0, report: '', notices: [] });
      });
    });

    describe('when vale reports an empty list and a value that is not a list', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nClean.\n\nA forbidden line the branch committed.\n\nStaged forbidden one.\n');
        sh(['add', 'doc.md']);
        result = runStagedCheck({ cwd: repo, env: { ...env, JSS_TEST_VALE_EMPTY: '1' } });
      });

      it('should pass with no report', () => {
        expect(result).toEqual({ exitCode: 0, report: '', notices: [] });
      });
    });

    describe('when vale itself fails', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nStaged.\n');
        sh(['add', 'doc.md']);
        result = runStagedCheck({ cwd: repo, env: { ...env, JSS_TEST_VALE_FAIL: '1' } });
      });

      it('should exit 2 naming the file and the error', () => {
        expect(result).toEqual({ exitCode: 2, report: '', notices: ['just-say-so: vale failed on doc.md: E_COLD_CALZONE'] });
      });
    });

    describe('when vale prints something that is not JSON', () => {
      let result;

      beforeEach(() => {
        write('doc.md', '# Doc\n\nStaged.\n');
        sh(['add', 'doc.md']);
        result = runStagedCheck({ cwd: repo, env: { ...env, JSS_TEST_VALE_GARBAGE: '1' } });
      });

      it('should exit 2 naming the file', () => {
        expect(result).toEqual({ exitCode: 2, report: '', notices: ['just-say-so: vale produced unparseable output on doc.md'] });
      });
    });
  });

  describe('when the skip flag is set', () => {
    let result;

    beforeEach(() => {
      result = runStagedCheck({ cwd: repo, env: { ...env, JUST_SAY_SO_PRECOMMIT: '0' } });
    });

    it('should skip with one notice', () => {
      expect(result).toEqual({ exitCode: 0, report: '', notices: ['just-say-so: check skipped (JUST_SAY_SO_PRECOMMIT=0)'] });
    });
  });

  describe('when the directory is not a git repository', () => {
    let result, outside;

    beforeEach(() => {
      outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-norepo-'));
      result = runStagedCheck({ cwd: outside, env: { ...env, GIT_CEILING_DIRECTORIES: path.dirname(outside) } });
    });

    afterEach(() => {
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('should exit 2 with the git error', () => {
      expect(result.exitCode).toBe(2);
      expect(result.report).toBe('');
      expect(result.notices).toEqual([expect.stringMatching(/^just-say-so: git rev-parse failed: fatal: not a git repository/)]);
    });
  });

  describe('when vale is not on PATH', () => {
    let result;

    beforeEach(() => {
      result = runStagedCheck({ cwd: repo, env: { ...env, PATH: path.join(repo, 'no-such-bin') } });
    });

    it('should skip with one notice', () => {
      expect(result).toEqual({ exitCode: 0, report: '', notices: ['just-say-so: vale not found on PATH; staged check skipped'] });
    });
  });

  describe('when the base does not exist', () => {
    let result;

    beforeEach(() => {
      result = runStagedCheck({ base: 'no-such-branch', cwd: repo, env });
    });

    it('should exit 2 with the git error', () => {
      expect(result.exitCode).toBe(2);
      expect(result.report).toBe('');
      expect(result.notices).toEqual([expect.stringMatching(/^just-say-so: git merge-base failed: fatal: Not a valid object name no-such-branch/)]);
    });
  });
});
