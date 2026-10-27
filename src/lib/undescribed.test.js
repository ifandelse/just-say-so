import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { describeRule, undescribedRules, formatUndescribed } from './undescribed.js';

/*
 * Branch map — src/lib/undescribed.js
 *   describeRule: scalar fields with and without quotes · tokens sample
 *     capped at five · swap keys sample · neither → [] · unreadable file
 *   undescribedRules: vale fails → null · error-level undescribed rules
 *     with their facts, described and disabled ones left out · minLevel
 *     suggestion includes warnings · a rules.extra bullet describes a rule
 *   formatUndescribed: null · empty · listing with optional lines
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-und-'));
}

function rule(dir, id, yaml) {
  const [style, name] = id.split('.');
  fs.mkdirSync(path.join(dir, style), { recursive: true });
  const file = path.join(dir, style, `${name}.yml`);
  fs.writeFileSync(file, yaml);
  return file;
}

describe('undescribed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('describeRule', () => {
    describe('when rule files of each shape are read', () => {
      let tokens, swap, bare, missing;

      beforeEach(() => {
        const dir = tmpdir();
        tokens = describeRule(
          'acme.Tokens',
          rule(dir, 'acme.Tokens', "extends: existence\nmessage: \"Banned: '%s'.\"\ndescription: 'Why it matters'\nlink: https://x.test/t\nlevel: error\ntokens:\n  - one\n  - 'two'\n  - \"three\"\n  - four\n  - five\n  - six\n"),
          'error'
        );
        swap = describeRule('acme.Swap', rule(dir, 'acme.Swap', 'extends: substitution\nmessage: Use %s\nswap:\n  utilize: use\n  "in order to": to\n'), 'warning');
        bare = describeRule('acme.Bare', rule(dir, 'acme.Bare', 'extends: metric\nformula: words\n'), 'warning');
        missing = describeRule('acme.Gone', path.join(dir, 'nope.yml'), 'error');
      });

      it('should read the scalars, strip quotes, and sample at most five tokens or swap keys', () => {
        expect({ tokens, swap, bare, missing }).toEqual({
          tokens: { id: 'acme.Tokens', level: 'error', extends: 'existence', message: "Banned: '%s'.", description: 'Why it matters', link: 'https://x.test/t', sample: ['one', 'two', 'three', 'four', 'five'] },
          swap: { id: 'acme.Swap', level: 'warning', extends: 'substitution', message: 'Use %s', description: null, link: null, sample: ['utilize', 'in order to'] },
          bare: { id: 'acme.Bare', level: 'warning', extends: 'metric', message: null, description: null, link: null, sample: [] },
          missing: { id: 'acme.Gone', level: 'error', extends: null, message: null, description: null, link: null, sample: [] }
        });
      });
    });
  });

  describe('undescribedRules', () => {
    describe('when vale cannot read the config', () => {
      let result;

      beforeEach(() => {
        mockSpawnSync.mockReturnValue({ status: 2, stdout: '' });
        result = undescribedRules(tmpdir(), { JUST_SAY_SO_CONFIG: '/nope.json' });
      });

      it('should return null', () => {
        expect(result).toBeNull();
      });
    });

    describe('when a project enables rules the manifest does not describe', () => {
      let errors, all;

      beforeEach(() => {
        const work = tmpdir();
        const styles = path.join(work, 'styles');
        rule(styles, 'JustSaySo.Buzzwords', 'extends: existence\nlevel: error\n');
        rule(styles, 'acme.Loud', 'extends: existence\nmessage: "Loud: %s"\nlevel: error\ntokens:\n  - zzz\n');
        rule(styles, 'acme.Soft', 'extends: existence\nmessage: "Soft"\nlevel: warning\n');
        rule(styles, 'acme.Off', 'extends: existence\nlevel: error\n');
        rule(styles, 'acme.Extra', 'extends: existence\nmessage: "Extra"\nlevel: error\n');
        fs.writeFileSync(path.join(work, 'rules.json'), JSON.stringify({ sections: [{ title: 'P', rules: [{ id: 'extra', full: 'x', vale: ['acme.Extra'] }] }] }));
        fs.writeFileSync(path.join(work, '.just-say-so.json'), JSON.stringify({ rules: { extra: path.join(work, 'rules.json') } }));
        mockSpawnSync.mockReturnValue({
          status: 0,
          stdout: JSON.stringify({ GBaseStyles: ['JustSaySo', 'acme'], GChecks: { 'acme.Off': false }, Paths: [styles], ConfigFiles: [] })
        });
        const env = { JUST_SAY_SO_CONFIG: path.join(work, 'none.json') };
        errors = undescribedRules(work, env);
        all = undescribedRules(work, env, { minLevel: 'suggestion' });
      });

      it('should list only the enabled, undescribed rules at the level floor, with their facts', () => {
        expect(errors).toEqual([{ id: 'acme.Loud', level: 'error', extends: 'existence', message: 'Loud: %s', description: null, link: null, sample: ['zzz'] }]);
        expect(all.map((r) => r.id)).toEqual(['acme.Loud', 'acme.Soft']);
      });
    });
  });

  describe('formatUndescribed', () => {
    it('should render the three outcomes', () => {
      expect(formatUndescribed(null)).toMatch(/^just-say-so: vale could not read the config here/);
      expect(formatUndescribed([])).toBe('just-say-so: every enabled rule at error level or above already has a bullet. Nothing to draft.\n');
      expect(
        formatUndescribed([
          { id: 'a.B', level: 'error', extends: 'existence', message: 'm', description: 'd', link: 'l', sample: ['x', 'y'] },
          { id: 'a.C', level: 'warning', extends: null, message: null, description: null, link: null, sample: [] }
        ], { minLevel: 'suggestion' })
      ).toBe('2 enabled rule(s) at suggestion level or above that no bullet describes:\n\na.B  [error, existence]\n  message: m\n  description: d\n  link: l\n  looks for: x · y\n\na.C  [warning]\n');
    });
  });
});
