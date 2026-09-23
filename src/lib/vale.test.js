import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import {
  shippedConfigPath,
  findValeConfig,
  resolveValeConfig,
  probeVale,
  lintPath,
  lintText,
  severityRank,
  countBySeverity,
  applyConfigExemptions,
  fileLineReader,
  formatAlerts
} from './vale.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-vale-'));
}

function alert(over = {}) {
  return {
    Check: 'JustSaySo.Buzzwords',
    Severity: 'error',
    Line: 1,
    Span: [1, 6],
    Match: 'flumo',
    Message: 'Banned.',
    ...over
  };
}

describe('vale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shippedConfigPath', () => {
    let result;

    beforeEach(() => {
      result = shippedConfigPath();
    });

    it('should point at a file that ships with the plugin', () => {
      expect(fs.existsSync(result)).toBe(true);
    });
  });

  describe('findValeConfig', () => {
    describe('when a .vale.ini sits in a parent directory', () => {
      let dir, result;

      beforeEach(() => {
        dir = tmp();
        fs.writeFileSync(path.join(dir, '.vale.ini'), 'MinAlertLevel = suggestion\n');
        fs.mkdirSync(path.join(dir, 'docs', 'deep'), { recursive: true });
        result = findValeConfig(path.join(dir, 'docs', 'deep'));
      });

      it('should return the parent config path', () => {
        expect(result).toBe(path.join(dir, '.vale.ini'));
      });
    });

    describe('when no config exists on the walk up', () => {
      let result;

      beforeEach(() => {
        result = findValeConfig(tmp());
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when the start directory is empty-ish input', () => {
      let result;

      beforeEach(() => {
        result = findValeConfig(null);
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });
  });

  describe('resolveValeConfig', () => {
    describe('when config.vale.config names a path', () => {
      let result;

      beforeEach(() => {
        result = resolveValeConfig('/anywhere', { vale: { config: '/etc/vale/policy.ini' } });
      });

      it('should return the override untouched', () => {
        expect(result).toBe('/etc/vale/policy.ini');
      });
    });

    describe('when the override starts with a tilde', () => {
      let result;

      beforeEach(() => {
        result = resolveValeConfig('/anywhere', { vale: { config: '~/vale.ini' } });
      });

      it('should expand it against the home directory', () => {
        expect(result).toBe(path.join(os.homedir(), 'vale.ini'));
      });
    });

    describe('when discovery finds a project config', () => {
      let dir, result;

      beforeEach(() => {
        dir = tmp();
        fs.writeFileSync(path.join(dir, '.vale.ini'), 'MinAlertLevel = suggestion\n');
        result = resolveValeConfig(dir, { vale: { config: null } });
      });

      it('should return the discovered config', () => {
        expect(result).toBe(path.join(dir, '.vale.ini'));
      });
    });

    describe('when nothing is configured or discovered', () => {
      let result;

      beforeEach(() => {
        result = resolveValeConfig(tmp(), { vale: { config: null } });
      });

      it('should fall back to the shipped config', () => {
        expect(result).toBe(shippedConfigPath());
      });
    });
  });

  describe('probeVale', () => {
    describe('when ls-dirs exits 0', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 0, stdout: '' });
        result = probeVale({});
      });

      it('should report the binary usable', () => {
        expect(result).toBe(true);
        expect(mockSpawnSync).toHaveBeenCalledTimes(1);
        expect(mockSpawnSync.mock.calls[0][0]).toBe('vale');
        expect(mockSpawnSync.mock.calls[0][1]).toEqual(['ls-dirs']);
      });
    });

    describe('when the binary is missing', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
        result = probeVale({});
      });

      it('should report it unusable', () => {
        expect(result).toBe(false);
      });
    });

    describe('when a different tool named vale rejects the subcommand', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 2, stdout: '', stderr: 'unknown command' });
        result = probeVale({});
      });

      it('should report it unusable', () => {
        expect(result).toBe(false);
      });
    });
  });

  describe('lintPath', () => {
    describe('when the file sits under the config directory', () => {
      let dir, result;

      beforeEach(() => {
        dir = tmp();
        fs.writeFileSync(path.join(dir, '.vale.ini'), 'MinAlertLevel = suggestion\n');
        fs.mkdirSync(path.join(dir, 'docs'));
        fs.writeFileSync(path.join(dir, 'docs', 'note.md'), 'flumo\n');
        mockSpawnSync.mockReturnValue({
          status: 1,
          stdout: JSON.stringify({ [path.join('docs', 'note.md')]: [alert()] })
        });
        result = lintPath(path.join(dir, 'docs', 'note.md'), {
          configPath: path.join(dir, '.vale.ini'),
          env: {}
        });
      });

      it('should pass the path relative to the config and run from its directory', () => {
        expect(mockSpawnSync).toHaveBeenCalledTimes(1);
        const [, args, opts] = mockSpawnSync.mock.calls[0];
        expect(args).toEqual([
          '--output=JSON',
          `--config=${path.join(dir, '.vale.ini')}`,
          path.join('docs', 'note.md')
        ]);
        expect(opts.cwd).toBe(dir);
      });

      it('should resolve alert file paths to absolute', () => {
        expect(result).toEqual([{ ...alert(), file: path.join(dir, 'docs', 'note.md') }]);
      });
    });

    describe('when the file sits outside the config directory', () => {
      let dir, result;

      beforeEach(() => {
        dir = tmp();
        fs.writeFileSync(path.join(dir, 'note.md'), 'clean\n');
        mockSpawnSync.mockReturnValue({ status: 0, stdout: '{}' });
        result = lintPath(path.join(dir, 'note.md'), { configPath: shippedConfigPath(), env: {} });
      });

      it('should run from the file directory with the bare filename', () => {
        const [, args, opts] = mockSpawnSync.mock.calls[0];
        expect(args[2]).toBe('note.md');
        expect(opts.cwd).toBe(dir);
      });

      it('should return an empty alert list for a clean file', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when vale itself fails', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 2, stdout: '', stderr: 'bad config' });
        result = lintPath('/tmp/x.md', { configPath: shippedConfigPath(), env: {} });
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when the binary is missing', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
        result = lintPath('/tmp/x.md', { configPath: shippedConfigPath(), env: {} });
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when stdout is not JSON', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 1, stdout: 'E_SOGGY_STROMBOLI' });
        result = lintPath('/tmp/x.md', { configPath: shippedConfigPath(), env: {} });
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when the JSON carries a non-array value', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 1, stdout: JSON.stringify({ 'x.md': 'not-a-list' }) });
        result = lintPath('/tmp/x.md', { configPath: shippedConfigPath(), env: {} });
      });

      it('should skip it and return the rest', () => {
        expect(result).toEqual([]);
      });
    });
  });

  describe('lintText', () => {
    describe('when the fragment lints with alerts', () => {
      let result, writtenText;

      beforeEach(() => {
        mockSpawnSync.mockImplementation((_cmd, args, opts) => {
          const target = args[args.length - 1];
          writtenText = fs.readFileSync(path.join(opts.cwd, target), 'utf8');
          return { status: 1, stdout: JSON.stringify({ [target]: [alert()] }) };
        });
        result = lintText('We flumo daily.', { configPath: shippedConfigPath(), env: {} });
      });

      it('should write the text to the named temp file before linting', () => {
        expect(writtenText).toBe('We flumo daily.');
        expect(mockSpawnSync.mock.calls[0][1][2]).toBe('reply.chat.md');
      });

      it('should return the alerts', () => {
        expect(result).toHaveLength(1);
      });

      it('should remove the temp file afterwards', () => {
        expect(fs.existsSync(mockSpawnSync.mock.calls[0][2].cwd)).toBe(false);
      });
    });

    describe('when the temp directory cannot be created', () => {
      let result, spy;

      beforeEach(() => {
        spy = vi.spyOn(fs, 'mkdtempSync').mockImplementation(() => {
          throw new Error('E_COLD_CALZONE');
        });
        result = lintText('anything', { configPath: shippedConfigPath(), env: {} });
      });

      afterEach(() => {
        spy.mockRestore();
      });

      it('should return null instead of throwing', () => {
        expect(result).toBeNull();
      });
    });
  });

  describe('severityRank', () => {
    let ranks;

    beforeEach(() => {
      ranks = ['error', 'warning', 'suggestion', 'E_UNKNOWN'].map(severityRank);
    });

    it('should rank error < warning < suggestion < anything else', () => {
      expect(ranks).toEqual([0, 1, 2, 3]);
    });
  });

  describe('countBySeverity', () => {
    let counts;

    beforeEach(() => {
      counts = countBySeverity([
        alert(),
        alert({ Severity: 'warning' }),
        alert({ Severity: 'suggestion' }),
        alert({ Severity: 'suggestion' }),
        alert({ Severity: 'E_UNKNOWN' })
      ]);
    });

    it('should count the three known levels and ignore the rest', () => {
      expect(counts).toEqual({ error: 1, warning: 1, suggestion: 2 });
    });
  });

  describe('applyConfigExemptions', () => {
    describe('when a disabled word matches with different case and hyphenation', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions(
          [alert({ Match: 'Cutting Edge' })],
          { disableWords: ['cutting-edge'] },
          () => null
        );
      });

      it('should drop the alert', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when the alert span sits inside an allowed phrase on its line', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions(
          [alert({ Match: 'robust', Span: [3, 8], Line: 1, file: 'F' })],
          { disableWords: [], allowPhrases: ['robust regression'] },
          () => 'a robust regression suite'
        );
      });

      it('should drop the alert', () => {
        expect(result).toEqual([]);
      });
    });

    describe('when the allowed phrase is elsewhere on the line', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions(
          [alert({ Match: 'robust', Span: [30, 35], Line: 1, file: 'F' })],
          { disableWords: [], allowPhrases: ['robust regression'] },
          () => 'a robust regression suite is robust'
        );
      });

      it('should keep the alert', () => {
        expect(result).toHaveLength(1);
      });
    });

    describe('when the line cannot be read', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions(
          [alert({ Match: 'robust' })],
          { disableWords: [], allowPhrases: ['robust regression'] },
          () => null
        );
      });

      it('should keep the alert', () => {
        expect(result).toHaveLength(1);
      });
    });

    describe('when the alert carries no span', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions(
          [alert({ Match: 'robust', Span: undefined })],
          { disableWords: [], allowPhrases: ['robust regression'] },
          () => 'a robust regression suite'
        );
      });

      it('should keep the alert', () => {
        expect(result).toHaveLength(1);
      });
    });

    describe('when no exemptions are configured', () => {
      let result;

      beforeEach(() => {
        result = applyConfigExemptions([alert()], {}, () => null);
      });

      it('should keep everything', () => {
        expect(result).toHaveLength(1);
      });
    });
  });

  describe('fileLineReader', () => {
    describe('when the file exists', () => {
      let reader, first, second, again;

      beforeEach(() => {
        const dir = tmp();
        const file = path.join(dir, 'lines.md');
        fs.writeFileSync(file, 'one\ntwo\n');
        reader = fileLineReader();
        first = reader(file, 1);
        second = reader(file, 2);
        again = reader(file, 99);
      });

      it('should return line content by 1-based number and null past the end', () => {
        expect([first, second, again]).toEqual(['one', 'two', null]);
      });
    });

    describe('when the file is missing', () => {
      let result;

      beforeEach(() => {
        result = fileLineReader()('/nope/missing.md', 1);
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });
  });

  describe('formatAlerts', () => {
    describe('when severities are mixed', () => {
      let result;

      beforeEach(() => {
        result = formatAlerts([
          alert({ Severity: 'suggestion', Line: 1, Match: 'soft' }),
          alert({ Severity: 'error', Line: 9, Match: 'hard' })
        ]);
      });

      it('should list errors before suggestions', () => {
        const lines = result.split('\n');
        expect(lines[0]).toContain('error');
        expect(lines[1]).toContain('suggestion');
      });
    });

    describe('when withFile is set', () => {
      let result;

      beforeEach(() => {
        result = formatAlerts([alert({ file: '/repo/doc.md', Line: 4 })], { withFile: true });
      });

      it('should prefix the location with the file path', () => {
        expect(result).toContain('/repo/doc.md:L4');
      });
    });

    describe('when the output would pass the limit', () => {
      let result;

      beforeEach(() => {
        const many = Array.from({ length: 50 }, (_, i) => alert({ Line: i + 1 }));
        result = formatAlerts(many, { limit: 200, truncatedNote: '(cut here)' });
      });

      it('should stop and append the truncation note', () => {
        expect(result.endsWith('  (cut here)')).toBe(true);
        expect(result.length).toBeLessThan(300);
      });
    });

    describe('when a match is longer than the display cap', () => {
      let result;

      beforeEach(() => {
        result = formatAlerts([alert({ Match: 'x'.repeat(80) })]);
      });

      it('should shorten it with an ellipsis', () => {
        expect(result).toContain('…');
        expect(result).not.toContain('x'.repeat(80));
      });
    });
  });
});
