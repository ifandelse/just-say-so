import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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
