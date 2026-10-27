import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { doctorReport, formatDoctor, TARGETS } from './doctor.js';
import { makeSandbox } from '../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/doctor.js
 *   vale missing → fact + warning, no targets · ls-config fails → warning
 *   config: explicit vale.config · discovered · fallback (warning)
 *   facts: legacy keys · publish sources · vocabulary present/absent/dangling
 *   warnings: package tag drift · sync needed (no .vale-config) · package
 *     listed but style missing · formats unmapped · chat.md section ·
 *     restated BasedOnStyles · JustSaySo not installed · installed but
 *     unselected · block mode with no error rule · dangling Vocab ·
 *     rules.extra unreadable · rules.extra naming an uninstalled rule
 *   targets: rules on per style, level counts, off list capped · sections column
 *   warnings: a brace-list section naming paths that do not exist
 *   raw: global and per-section lines, levels folded in
 *   formatDoctor: no warnings line · numbered warnings
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-doc-'));
}

function stylesWith(dir, rules) {
  for (const [id, level] of Object.entries(rules)) {
    const [style, name] = id.split('.');
    fs.mkdirSync(path.join(dir, style), { recursive: true });
    fs.writeFileSync(path.join(dir, style, `${name}.yml`), `extends: existence\nlevel: ${level}\n`);
  }
}

function vale({ found = true, resolved = null, version = 'vale version 3.24.0' } = {}) {
  mockSpawnSync.mockImplementation((_cmd, args) => {
    if (args[0] === 'ls-dirs') return found ? { status: 0, stdout: '' } : { error: new Error('ENOENT'), status: null };
    if (args[0] === '--version') return { status: 0, stdout: `${version}\n` };
    if (args[0] === 'ls-config') return resolved ? { status: 0, stdout: JSON.stringify(resolved) } : { status: 2, stdout: '' };
    return { status: 0, stdout: '' };
  });
}

describe('doctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when vale is missing', () => {
    let report, text;

    beforeEach(() => {
      const sandbox = makeSandbox();
      vale({ found: false });
      report = doctorReport(sandbox.work, sandbox.env);
      text = formatDoctor(report);
    });

    it('should report the miss, skip the targets, and warn about the fallback and the binary', () => {
      expect(report.targets).toEqual([]);
      expect(report.facts[0]).toBe('vale: missing from PATH, or not errata-ai vale');
      expect(report.warnings).toEqual([
        expect.stringMatching(/^vale is missing from PATH, or is a different tool named vale\./),
        expect.stringMatching(/^No \.vale\.ini above this directory, so the shipped fallback applies here/)
      ]);
      expect(text).toMatch(/^just-say-so doctor — plugin \d+\.\d+\.\d+\n\nSetup\n/);
      expect(text).toContain('Warnings (2)\n  - vale is missing');
    });
  });

  describe('when a project is set up well', () => {
    let report, text;

    beforeEach(() => {
      const work = tmpdir();
      const styles = path.join(work, 'styles');
      stylesWith(styles, { 'JustSaySo.Buzzwords': 'error', 'JustSaySo.Intensifiers': 'suggestion', 'acme.Dash': 'error' });
      fs.mkdirSync(path.join(styles, '.vale-config'));
      fs.writeFileSync(path.join(styles, '.vale-config', '0-JustSaySo.ini'), '[formats]\nreply = md\npublish = md\n[*.reply]\nBasedOnStyles = JustSaySo\n');
      fs.mkdirSync(path.join(styles, 'config', 'vocabularies', 'Project'), { recursive: true });
      fs.writeFileSync(path.join(styles, 'config', 'vocabularies', 'Project', 'accept.txt'), 'robust regression\nTLS\n');
      const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.claude-plugin', 'plugin.json'), 'utf8')).version;
      const ini = path.join(work, '.vale.ini');
      fs.writeFileSync(
        ini,
        `StylesPath = styles\nVocab = Project\nPackages = https://github.com/ifandelse/just-say-so/releases/download/v${version}/JustSaySo.zip\n[*]\nBasedOnStyles = JustSaySo, acme\n[*.reply]\nJustSaySo.Intensifiers = NO\n`
      );
      fs.writeFileSync(path.join(work, '.just-say-so.json'), JSON.stringify({ publish: { gh: true, mcp: ['mcp__x__*'] }, reply: { mode: 'block' } }));
      vale({
        resolved: {
          Formats: { reply: 'md', publish: 'md' },
          GBaseStyles: ['JustSaySo', 'acme'],
          GChecks: {},
          SBaseStyles: { '*.reply': ['JustSaySo'] },
          SChecks: { '*.reply': { 'JustSaySo.Intensifiers': false } },
          RuleToLevel: {},
          SLevels: { '*.reply': {} },
          Paths: [styles],
          ConfigFiles: [ini]
        }
      });
      const env = { JUST_SAY_SO_CONFIG: path.join(work, 'none.json'), JUST_SAY_SO_STATE_DIR: path.join(work, 'state') };
      report = doctorReport(work, env);
      text = formatDoctor(report);
    });

    it('should list the facts, read each target, print the raw sections, and warn only about the restated list', () => {
      expect(report.facts.slice(2)).toEqual([
        'targets: files warn (show suggestion) · publish block, gh, mcp 1 pattern(s), artifact · reply block',
        'rules: context start [startup, resume, clear, compact] · subagents yes · on violation yes',
        expect.stringMatching(/^vale config: .*\.vale\.ini \(nearest above cwd\)$/),
        expect.stringMatching(/^packages: https:\/\/github\.com\/ifandelse\/just-say-so\/releases\/download\/v[\d.]+\/JustSaySo\.zip$/),
        'vocabulary: Project (2 accepted)',
        'formats: reply = md, publish = md'
      ]);
      expect(report.targets.map((t) => [t.label, t.line.replace(/\s+/g, ' ').trim(), t.sections])).toEqual([
        ['reply', 'reply reply.reply JustSaySo 1 of 2 rules on · levels: 1 error · off: JustSaySo.Intensifiers', '[*] [*.reply]'],
        ['publish', 'publish gh.pr.body.publish JustSaySo 2 of 2 rules on · acme 1 of 1 rules on · levels: 2 error, 1 suggestion', '[*]'],
        ['artifact', 'artifact artifact.page.html JustSaySo 2 of 2 rules on · acme 1 of 1 rules on · levels: 2 error, 1 suggestion', '[*]'],
        ['files .md', 'files .md doc.md JustSaySo 2 of 2 rules on · acme 1 of 1 rules on · levels: 2 error, 1 suggestion', '[*]'],
        ['files .html', 'files .html page.html JustSaySo 2 of 2 rules on · acme 1 of 1 rules on · levels: 2 error, 1 suggestion', '[*]'],
        ['files .js', 'files .js code.js JustSaySo 2 of 2 rules on · acme 1 of 1 rules on · levels: 2 error, 1 suggestion', '[*]']
      ]);
      expect(report.raw).toEqual(['[*] BasedOnStyles = JustSaySo, acme', '[*.reply] BasedOnStyles = JustSaySo; JustSaySo.Intensifiers = NO']);
      expect(report.warnings).toEqual([
        'Section [*.reply] restates BasedOnStyles as "JustSaySo", so the [*] styles (JustSaySo, acme) do not reach it. Restate the whole list there, or use Style = NO lines instead.'
      ]);
      expect(text).toContain("Targets (the plugin's reading of the Vale config: rules on per style, then how many of those sit at each level)");
      expect(text).toContain('Raw section settings, in the order Vale applies them');
    });
  });

  describe('when a project has every problem at once', () => {
    let report;

    beforeEach(() => {
      const work = tmpdir();
      const styles = path.join(work, 'styles');
      stylesWith(styles, { 'JustSaySo.Buzzwords': 'error', 'Local.Soft': 'warning' });
      const ini = path.join(work, '.vale.ini');
      fs.writeFileSync(
        ini,
        'StylesPath = styles\nVocab = Ghost\nPackages = https://github.com/ifandelse/just-say-so/releases/download/v0.1.0/JustSaySo.zip\n[*]\nBasedOnStyles = Local\n[*.chat.md]\nBasedOnStyles = Local\n[{README.md,gone.md,docs/**}]\nBasedOnStyles =\n'
      );
      fs.writeFileSync(path.join(work, '.just-say-so.json'), JSON.stringify({ outputCheck: { mode: 'block' }, files: { mode: 'block' }, reply: { mode: 'block' }, publish: { mode: 'block', gh: true } }));
      vale({
        resolved: {
          Formats: {},
          GBaseStyles: ['Local'],
          GChecks: {},
          SBaseStyles: { '*.chat.md': ['Local'], '{README.md,gone.md,docs/**}': [] },
          SChecks: { '*.chat.md': {} },
          RuleToLevel: {},
          SLevels: {},
          Paths: [styles],
          ConfigFiles: [ini]
        }
      });
      report = doctorReport(work, { JUST_SAY_SO_CONFIG: path.join(work, 'none.json'), JUST_SAY_SO_STATE_DIR: path.join(work, 'state') });
    });

    it('should raise every warning once', () => {
      expect(report.warnings).toEqual([
        expect.stringMatching(/\.just-say-so\.json sets outputCheck, which 0\.9\.0 and later do not read/),
        expect.stringMatching(/^The JustSaySo package is pinned at v0\.1\.0 and the plugin is /),
        expect.stringMatching(/^Packages are listed but .* holds no synced package config\. Run vale sync\.$/),
        expect.stringMatching(/^Vocab = Ghost names a vocabulary with no directory/),
        expect.stringMatching(/^reply and publish are not mapped to Markdown/),
        'Section [*.chat.md] matches nothing since 0.9.0. Rename it to [*.reply] or [*.publish].',
        'Section [{README.md,gone.md,docs/**}] names paths that do not exist: README.md, gone.md. Drop them from the list.',
        expect.stringMatching(/^The JustSaySo style is installed but no section lists it/),
        'files .md is in block mode but no error-level rule is enabled for doc.md, so it can never block.',
        'publish is in block mode but no error-level rule is enabled for gh.pr.body.publish, so it can never block.',
        'artifact is in block mode but no error-level rule is enabled for artifact.page.html, so it can never block.',
        'reply is in block mode but no error-level rule is enabled for reply.reply, so it can never block.'
      ]);
    });
  });

  describe('when rules.extra names a rule no style has, or cannot be read', () => {
    let unknown, unreadable;

    beforeEach(() => {
      const work = tmpdir();
      const styles = path.join(work, 'styles');
      stylesWith(styles, { 'JustSaySo.Buzzwords': 'error' });
      fs.writeFileSync(path.join(work, '.vale.ini'), 'StylesPath = styles\n[*]\nBasedOnStyles = JustSaySo\n');
      fs.writeFileSync(path.join(work, 'x.json'), JSON.stringify({ sections: [{ title: 'P', rules: [{ id: 'dash', full: 'x', vale: ['ai-tells.EmDashUsage', 'JustSaySo.Buzzwords'] }] }] }));
      const resolved = { Formats: { reply: 'md', publish: 'md' }, GBaseStyles: ['JustSaySo'], Paths: [styles], ConfigFiles: [] };
      vale({ resolved });
      fs.writeFileSync(path.join(work, 'none.json'), JSON.stringify({ rules: { extra: path.join(work, 'x.json') } }));
      unknown = doctorReport(work, { JUST_SAY_SO_CONFIG: path.join(work, 'none.json') });
      fs.writeFileSync(path.join(work, 'none.json'), JSON.stringify({ rules: { extra: path.join(work, 'missing.json') } }));
      unreadable = doctorReport(work, { JUST_SAY_SO_CONFIG: path.join(work, 'none.json') });
    });

    it('should name the unknown id with its bullet, and the unreadable file', () => {
      expect(unknown.warnings).toContain('rules.extra names Vale rules no installed style has: ai-tells.EmDashUsage (bullet dash). Fix the id or sync the style.');
      expect(unreadable.warnings.some((w) => w.startsWith('rules.extra names ') && w.includes('cannot be read as JSON'))).toBe(true);
    });
  });

  describe('when vale cannot read the config, or the config is explicit', () => {
    let unreadable, explicit;

    beforeEach(() => {
      const work = tmpdir();
      fs.writeFileSync(path.join(work, 'custom.ini'), 'StylesPath = styles\n');
      vale({ resolved: null });
      unreadable = doctorReport(work, { JUST_SAY_SO_CONFIG: path.join(work, 'none.json') });
      fs.writeFileSync(path.join(work, 'none.json'), JSON.stringify({ vale: { config: path.join(work, 'custom.ini') } }));
      vale({ resolved: { Formats: { reply: 'md', publish: 'md' }, GBaseStyles: [], Paths: [], ConfigFiles: [] } });
      explicit = doctorReport(work, { JUST_SAY_SO_CONFIG: path.join(work, 'none.json') });
    });

    it('should warn about the unreadable config and name the explicit one', () => {
      expect(unreadable.warnings.some((w) => w.startsWith('vale ls-config could not read'))).toBe(true);
      expect(explicit.facts.find((f) => f.startsWith('vale config:'))).toMatch(/custom\.ini \(vale\.config\)$/);
      expect(explicit.warnings).toEqual([
        'The JustSaySo style is not installed under any styles path this config reads.',
        'artifact is in block mode but no error-level rule is enabled for artifact.page.html, so it can never block.'
      ]);
    });
  });

  describe('TARGETS', () => {
    it('should name one lint target per plugin target and the three file kinds', () => {
      expect(TARGETS.map(([label]) => label)).toEqual(['reply', 'publish', 'artifact', 'files .md', 'files .html', 'files .js']);
    });
  });
});
