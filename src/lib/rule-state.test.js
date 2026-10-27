import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { ruleStateFor, contextRules } from './rule-state.js';
import { DEFAULTS } from './config.js';

/*
 * Branch map — src/lib/rule-state.js
 *   ruleStateFor: global styles · a matching section's BasedOnStyles
 *     replaces them · Style = NO · Style.Rule = NO · Style.Rule = level
 *     enables and re-levels · sections that do not match the name are
 *     ignored · a rule outside the inventory is absent
 *   contextRules: vale fails or prints junk → the plain condensed text ·
 *     a bullet whose installed Vale rules are all off is dropped, an
 *     uninstalled rule not counting · a bullet with only uninstalled
 *     rules stays · error rules no bullet names are appended, capped,
 *     sorted · nothing to append → no trailer
 */

function stylesDir(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rs-'));
  for (const [id, level] of Object.entries(rules)) {
    const [style, name] = id.split('.');
    fs.mkdirSync(path.join(dir, style), { recursive: true });
    fs.writeFileSync(path.join(dir, style, `${name}.yml`), `extends: existence\nlevel: ${level}\n`);
  }
  return dir;
}

function resolvedWith(over = {}) {
  return {
    GBaseStyles: ['JustSaySo', 'STE'],
    GChecks: {},
    SBaseStyles: {},
    SChecks: {},
    RuleToLevel: {},
    SLevels: {},
    Paths: [],
    ...over
  };
}

function valeSays(resolved) {
  mockSpawnSync.mockImplementation((_cmd, args) => {
    if (args[0] === 'ls-config') {
      return resolved === null ? { status: 2, stdout: '' } : { status: 0, stdout: typeof resolved === 'string' ? resolved : JSON.stringify(resolved) };
    }
    return { status: 0, stdout: '' };
  });
}

describe('rule-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ruleStateFor', () => {
    describe('when the config has global styles, a reply section, and an unrelated section', () => {
      let state;

      beforeEach(() => {
        const inventory = new Map([
          ['JustSaySo.Buzzwords', 'error'],
          ['JustSaySo.Intensifiers', 'suggestion'],
          ['STE.Articles', 'error'],
          ['STE.SentenceLength', 'warning'],
          ['Plain.Passive', 'suggestion'],
          ['Tells.Dash', 'error']
        ]);
        const resolved = resolvedWith({
          GChecks: { 'JustSaySo.Intensifiers': false, 'Tells.Dash': true },
          RuleToLevel: { 'Tells.Dash': 'warning' },
          SChecks: { '*.reply': { STE: false, 'Plain.Passive': true }, '*.md': { 'JustSaySo.Buzzwords': false } },
          SLevels: { '*.reply': { 'Plain.Passive': 'error' }, '*.md': { 'STE.Articles': 'suggestion' } }
        });
        state = ruleStateFor('reply.reply', resolved, inventory);
      });

      it('should combine the global and matching-section settings and ignore the rest', () => {
        expect(Object.fromEntries(state)).toEqual({
          'JustSaySo.Buzzwords': { enabled: true, level: 'error' },
          'JustSaySo.Intensifiers': { enabled: false, level: 'suggestion' },
          'STE.Articles': { enabled: false, level: 'error' },
          'STE.SentenceLength': { enabled: false, level: 'warning' },
          'Plain.Passive': { enabled: true, level: 'error' },
          'Tells.Dash': { enabled: true, level: 'warning' }
        });
      });
    });

    describe('when a matching section restates BasedOnStyles', () => {
      let state;

      beforeEach(() => {
        const inventory = new Map([
          ['JustSaySo.Buzzwords', 'error'],
          ['Local.Dash', 'error']
        ]);
        state = ruleStateFor('reply.reply', resolvedWith({ SBaseStyles: { '*.reply': ['Local'] } }), inventory);
      });

      it('should replace the global list with the section list', () => {
        expect(Object.fromEntries(state)).toEqual({
          'JustSaySo.Buzzwords': { enabled: false, level: 'error' },
          'Local.Dash': { enabled: true, level: 'error' }
        });
      });
    });
  });

  describe('contextRules', () => {
    describe('when vale cannot report the config', () => {
      let failed, junk;

      beforeEach(() => {
        valeSays(null);
        failed = contextRules(DEFAULTS, os.tmpdir(), {});
        valeSays('nope');
        junk = contextRules(DEFAULTS, os.tmpdir(), {});
      });

      it('should return the plain condensed text both times', () => {
        expect(failed).toBe(junk);
        expect(failed).toMatch(/^## Communication rules — reminder\n/);
        expect(failed).toContain('- Empty intensifiers: very, truly, crucial, vital.');
      });
    });

    describe('when the project turns off every rule behind one bullet and adds error rules of its own', () => {
      let text;

      beforeEach(() => {
        const dir = stylesDir({
          'JustSaySo.Intensifiers': 'suggestion',
          'JustSaySo.Buzzwords': 'error',
          'acme.Alpha': 'error',
          'acme.Beta': 'error',
          'acme.Gamma': 'warning',
          'acme.Delta': 'error'
        });
        valeSays(
          resolvedWith({
            GBaseStyles: ['JustSaySo', 'acme'],
            GChecks: { 'JustSaySo.Intensifiers': false, 'acme.Delta': false },
            Paths: [dir]
          })
        );
        text = contextRules(DEFAULTS, os.tmpdir(), {});
      });

      it('should drop the intensifiers bullet (its ai-tells twin is not installed), keep bullets with only uninstalled rules, and name the undescribed error rules', () => {
        expect(text).not.toContain('Empty intensifiers');
        expect(text).toContain('- One idea per sentence.');
        expect(text).toMatch(/\n\nThis project also enforces these Vale rules at error level: acme\.Alpha, acme\.Beta\.\n$/);
      });
    });

    describe('when more undescribed error rules exist than the cap', () => {
      let text;

      beforeEach(() => {
        const rules = {};
        for (let i = 0; i < 15; i++) rules[`acme.R${String(i).padStart(2, '0')}`] = 'error';
        const dir = stylesDir(rules);
        valeSays(resolvedWith({ GBaseStyles: ['acme'], Paths: [dir] }));
        text = contextRules(DEFAULTS, os.tmpdir(), {});
      });

      it('should name twelve and count the rest', () => {
        expect(text).toMatch(/acme\.R00, (acme\.R\d\d, ){10}acme\.R11 \(and 3 more\)\.\n$/);
      });
    });

    describe('when every enabled error rule is described by a bullet', () => {
      let text;

      beforeEach(() => {
        const dir = stylesDir({ 'JustSaySo.Buzzwords': 'error', 'JustSaySo.Intensifiers': 'suggestion' });
        valeSays(resolvedWith({ GBaseStyles: ['JustSaySo'], Paths: [dir] }));
        text = contextRules(DEFAULTS, os.tmpdir(), {});
      });

      it('should add no trailer', () => {
        expect(text).not.toContain('also enforces');
        expect(text.endsWith('- Delete any sentence whose removal loses nothing.\n')).toBe(true);
      });
    });
  });
});
