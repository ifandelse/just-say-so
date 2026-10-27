import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { ruleStateFor, sectionOrder, contextRules } from './rule-state.js';
import { DEFAULTS } from './config.js';

/*
 * Branch map — src/lib/rule-state.js
 *   sectionOrder: package .vale-config/*.ini in name order, then the
 *     config files · [formats] and [*] skipped · a trailing comment and a
 *     character class inside the header are kept the way Vale keeps them ·
 *     globs only the maps hold come last · unreadable file skipped
 *   ruleStateFor: global styles · a matching section's BasedOnStyles
 *     replaces them, an empty list included · later section wins over an
 *     earlier one in file order · Style = NO · Style.Rule = NO · YES
 *     re-enables · style-wide level · per-rule level beats style-wide in
 *     the same section · a narrower section beats the global one either
 *     way · brace-alternative sections match · sections that do not
 *     match the name are ignored · a style-wide YES or level never selects
 *     a style, a later YES undoes NO on a selected style, a per-rule YES
 *     loads the rule after an empty BasedOnStyles or a style NO · across
 *     sections a later style YES/NO or list beats an earlier per-rule
 *     setting from [*], a new list keeps every NO and drops every earlier
 *     YES, a section per-rule setting beats a section style setting in
 *     either order, [*] settings are fallbacks a section's mention of the
 *     rule or its style overrides, a section style YES runs a rule a
 *     per-rule setting mentions anywhere
 *   contextRules: vale fails or prints junk → the plain condensed text ·
 *     vale: false → the plain text, no spawn · a bullet whose installed
 *     Vale rules are all off is dropped, an uninstalled rule not counting ·
 *     a bullet with only uninstalled rules stays · error rules no bullet
 *     names are appended, capped, sorted · a style-wide level below error
 *     keeps a rule out of the trailer · nothing to append → no trailer
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rs-'));
}

function stylesDir(rules, dir = tmpdir()) {
  for (const [id, level] of Object.entries(rules)) {
    const [style, name] = id.split('.');
    fs.mkdirSync(path.join(dir, style), { recursive: true });
    fs.writeFileSync(path.join(dir, style, `${name}.yml`), `extends: existence\nlevel: ${level}\n`);
  }
  return dir;
}

function iniFile(text, dir = tmpdir(), name = '.vale.ini') {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
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
    ConfigFiles: [],
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

  describe('sectionOrder', () => {
    describe('when a package config, a project config, and an orphan map key exist', () => {
      let order;

      beforeEach(() => {
        const styles = tmpdir();
        iniFile('[formats]\nreply = md\n[*.reply]\nP.Rule = NO\n', path.join(styles, '.vale-config'), '1-Q.ini');
        iniFile('[*.publish]\nP.Rule = NO\n', path.join(styles, '.vale-config'), '0-P.ini');
        const project = iniFile(
          'StylesPath = styles\n[*]\nBasedOnStyles = X\n  [reply.*]  \nX.A = YES\n[r*.reply] # the first match\nX.A = NO\n[reply.[r]eply]\nX.A = NO\n[{*.reply,*.publish}]\nX.A = NO\n[broken\n'
        );
        order = sectionOrder(
          resolvedWith({
            Paths: [styles, path.join(styles, 'MISSING')],
            ConfigFiles: [project, '/nowhere/.vale.ini'],
            SChecks: { '*.md': {}, 'reply.*': {} }
          })
        );
      });

      it('should list package sections first, then the project sections, then map-only globs', () => {
        expect(order).toEqual(['*.publish', '*.reply', 'reply.*', 'r*.reply', 'reply.[r]eply', '{*.reply,*.publish}', '*.md']);
      });
    });
  });

  describe('ruleStateFor', () => {
    const inventory = new Map([
      ['JustSaySo.Buzzwords', 'error'],
      ['JustSaySo.Intensifiers', 'suggestion'],
      ['STE.Articles', 'error'],
      ['Local.Extra', 'error'],
      ['Local.Other', 'warning']
    ]);

    describe('when sections toggle rules in file order with brace globs and an unrelated section', () => {
      let state;

      beforeEach(() => {
        const resolved = resolvedWith({
          GBaseStyles: ['JustSaySo', 'STE', 'Local'],
          GChecks: { 'JustSaySo.Intensifiers': false },
          SChecks: {
            '*.reply': { 'JustSaySo.Intensifiers': true, STE: false },
            'reply.*': { 'JustSaySo.Intensifiers': false },
            '{*.reply,*.publish}': { 'Local.Other': false },
            '*.md': { 'JustSaySo.Buzzwords': false }
          }
        });
        // File order: reply.* (NO) comes after *.reply (YES), so NO wins.
        state = ruleStateFor('reply.reply', resolved, inventory, ['*.md', '*.reply', 'reply.*', '{*.reply,*.publish}']);
      });

      it('should apply the matching sections in that order and ignore the rest', () => {
        expect(Object.fromEntries(state)).toEqual({
          'JustSaySo.Buzzwords': { enabled: true, level: 'error' },
          'JustSaySo.Intensifiers': { enabled: false, level: 'suggestion' },
          'STE.Articles': { enabled: false, level: 'error' },
          'Local.Extra': { enabled: true, level: 'error' },
          'Local.Other': { enabled: false, level: 'warning' }
        });
      });
    });

    describe('when the same sections come in the other file order', () => {
      let state;

      beforeEach(() => {
        const resolved = resolvedWith({
          GBaseStyles: ['JustSaySo'],
          SChecks: { '*.reply': { 'JustSaySo.Intensifiers': true }, 'reply.*': { 'JustSaySo.Intensifiers': false } }
        });
        state = ruleStateFor('reply.reply', resolved, inventory, ['reply.*', '*.reply']);
      });

      it('should let the later section win', () => {
        expect(state.get('JustSaySo.Intensifiers')).toEqual({ enabled: true, level: 'suggestion' });
      });
    });

    describe('when a matching section sets an empty BasedOnStyles', () => {
      let state;

      beforeEach(() => {
        state = ruleStateFor('reply.reply', resolvedWith({ SBaseStyles: { '*.reply': [] } }), inventory, ['*.reply']);
      });

      it('should disable every style', () => {
        expect([...state.values()].map((s) => s.enabled)).toEqual([false, false, false, false, false]);
      });
    });

    describe('when a matching section restates BasedOnStyles', () => {
      let state;

      beforeEach(() => {
        state = ruleStateFor('reply.reply', resolvedWith({ SBaseStyles: { '*.reply': ['Local'] } }), inventory, ['*.reply']);
      });

      it('should replace the global list with the section list', () => {
        expect([...state.entries()].map(([id, s]) => [id, s.enabled])).toEqual([
          ['JustSaySo.Buzzwords', false],
          ['JustSaySo.Intensifiers', false],
          ['STE.Articles', false],
          ['Local.Extra', true],
          ['Local.Other', true]
        ]);
      });
    });

    describe('when styles are toggled or leveled without being selected', () => {
      let unselectedYes, laterYes, emptyListWithLevel, ruleYesAfterEmpty, ruleYesInsideStyleNo;

      beforeEach(() => {
        const inv = new Map([
          ['Local.Extra', 'error'],
          ['Local.Other', 'warning']
        ]);
        // [*] Local = YES with no BasedOnStyles: nothing runs.
        unselectedYes = ruleStateFor('reply.reply', resolvedWith({ GBaseStyles: [], GChecks: { Local: true } }), inv, []);
        // [*] BasedOnStyles = Local; [*.reply] Local = NO; [reply.*] Local = YES: back on.
        laterYes = ruleStateFor(
          'reply.reply',
          resolvedWith({ GBaseStyles: ['Local'], SChecks: { '*.reply': { Local: false }, 'reply.*': { Local: true } } }),
          inv,
          ['*.reply', 'reply.*']
        );
        // [*] BasedOnStyles = Local, Local = suggestion; [*.reply] BasedOnStyles = (empty): off.
        emptyListWithLevel = ruleStateFor(
          'reply.reply',
          resolvedWith({ GBaseStyles: ['Local'], GChecks: { Local: true }, RuleToLevel: { Local: 'suggestion' }, SBaseStyles: { '*.reply': [] } }),
          inv,
          ['*.reply']
        );
        // [*.reply] BasedOnStyles = (empty) then Local.Extra = YES: that one rule runs.
        ruleYesAfterEmpty = ruleStateFor(
          'reply.reply',
          resolvedWith({ GBaseStyles: ['Local'], SBaseStyles: { '*.reply': [] }, SChecks: { '*.reply': { 'Local.Extra': true } } }),
          inv,
          ['*.reply']
        );
        // [*.reply] Local = NO plus Local.Extra = YES: the per-rule setting decides.
        ruleYesInsideStyleNo = ruleStateFor(
          'reply.reply',
          resolvedWith({ GBaseStyles: ['Local'], SChecks: { '*.reply': { Local: false, 'Local.Extra': true } } }),
          inv,
          ['*.reply']
        );
      });

      it('should select only through BasedOnStyles and let per-rule settings decide', () => {
        const on = (state) => [...state.entries()].filter(([, s]) => s.enabled).map(([id]) => id);
        expect({
          unselectedYes: on(unselectedYes),
          laterYes: on(laterYes),
          emptyListWithLevel: on(emptyListWithLevel),
          ruleYesAfterEmpty: on(ruleYesAfterEmpty),
          ruleYesInsideStyleNo: on(ruleYesInsideStyleNo)
        }).toEqual({
          unselectedYes: [],
          laterYes: ['Local.Extra', 'Local.Other'],
          emptyListWithLevel: [],
          ruleYesAfterEmpty: ['Local.Extra'],
          ruleYesInsideStyleNo: ['Local.Extra']
        });
      });
    });

    describe('when per-rule and style-wide settings meet across sections', () => {
      let results;

      beforeEach(() => {
        const inv = new Map([
          ['Local.Extra', 'error'],
          ['Local.Other', 'warning']
        ]);
        const on = (state) => [...state.entries()].filter(([, s]) => s.enabled).map(([id]) => id);
        const run = (over, order) => on(ruleStateFor('reply.reply', resolvedWith({ GBaseStyles: ['Local'], ...over }), inv, order));
        results = {
          // [*] Extra = NO; [*.reply] Local = YES: the later style YES clears the rule NO.
          ruleNoThenStyleYes: run({ GChecks: { 'Local.Extra': false }, SChecks: { '*.reply': { Local: true } } }, ['*.reply']),
          // [*] Extra = YES; [*.reply] Local = NO: the later style NO excludes the rule.
          ruleYesThenStyleNo: run({ GChecks: { 'Local.Extra': true }, SChecks: { '*.reply': { Local: false } } }, ['*.reply']),
          // [*] Extra = YES; [*.reply] BasedOnStyles = (empty): the new list drops the rule.
          ruleYesThenEmptyList: run({ GChecks: { 'Local.Extra': true }, SBaseStyles: { '*.reply': [] } }, ['*.reply']),
          // [*.reply] Extra = NO; [reply.*] BasedOnStyles = Local: a new list keeps the exclusion.
          ruleNoThenList: run({ SChecks: { '*.reply': { 'Local.Extra': false } }, SBaseStyles: { 'reply.*': ['Local'] } }, ['*.reply', 'reply.*']),
          // [*.reply] Local = NO; [reply.*] BasedOnStyles = Local: same for a style NO.
          styleNoThenList: run({ SChecks: { '*.reply': { Local: false } }, SBaseStyles: { 'reply.*': ['Local'] } }, ['*.reply', 'reply.*']),
          // [*.reply] Local = NO; [reply.*] BasedOnStyles = (empty) plus Extra = YES: the rule YES wins.
          styleNoThenEmptyListRuleYes: run(
            { SChecks: { '*.reply': { Local: false }, 'reply.*': { 'Local.Extra': true } }, SBaseStyles: { 'reply.*': [] } },
            ['*.reply', 'reply.*']
          ),
          // No list anywhere: [*] Extra = YES; [*.reply] Local = NO: the section style NO beats the global rule YES.
          globalRuleYesThenSectionStyleNo: run({ GBaseStyles: [], GChecks: { 'Local.Extra': true }, SChecks: { '*.reply': { Local: false } } }, ['*.reply']),
          // No list anywhere: [*] Extra = NO; [*.reply] Local = YES: the section style YES runs the mentioned rule.
          globalRuleNoThenSectionStyleYes: run({ GBaseStyles: [], GChecks: { 'Local.Extra': false }, SChecks: { '*.reply': { Local: true } } }, ['*.reply']),
          // [*] Local = NO; [*.reply] BasedOnStyles = Local: the global style NO still holds.
          globalStyleNoThenList: run({ GBaseStyles: [], GChecks: { Local: false }, SBaseStyles: { '*.reply': ['Local'] } }, ['*.reply']),
          // Unselected style: [*.reply] Extra = YES; [reply.*] Local = NO: a section rule setting beats a section style setting.
          sectionRuleYesThenSectionStyleNo: run({ GBaseStyles: [], SChecks: { '*.reply': { 'Local.Extra': true }, 'reply.*': { Local: false } } }, ['*.reply', 'reply.*']),
          // [*.reply] Extra = NO; [reply.*] Local = YES: the section rule NO survives a later section style YES.
          sectionRuleNoThenSectionStyleYes: run({ SChecks: { '*.reply': { 'Local.Extra': false }, 'reply.*': { Local: true } } }, ['*.reply', 'reply.*']),
          // [*] Extra = NO; [*.reply] BasedOnStyles = Local plus Local = YES: the style YES clears it.
          ruleNoThenListAndStyleYes: run(
            { GChecks: { 'Local.Extra': false }, SBaseStyles: { '*.reply': ['Local'] }, SChecks: { '*.reply': { Local: true } } },
            ['*.reply']
          )
        };
      });

      it('should resolve each the way Vale 3.24.0 does', () => {
        expect(results).toEqual({
          ruleNoThenStyleYes: ['Local.Extra', 'Local.Other'],
          ruleYesThenStyleNo: [],
          ruleYesThenEmptyList: [],
          ruleNoThenList: ['Local.Other'],
          styleNoThenList: [],
          styleNoThenEmptyListRuleYes: ['Local.Extra'],
          globalRuleYesThenSectionStyleNo: [],
          globalRuleNoThenSectionStyleYes: ['Local.Extra'],
          globalStyleNoThenList: [],
          sectionRuleYesThenSectionStyleNo: ['Local.Extra'],
          sectionRuleNoThenSectionStyleYes: ['Local.Other'],
          ruleNoThenListAndStyleYes: ['Local.Extra', 'Local.Other']
        });
      });
    });

    describe('when levels are set style-wide and per rule across sections', () => {
      let global, narrowerStyle, narrowerRule, sectionRuleOverLaterSectionStyle;

      beforeEach(() => {
        const base = { GBaseStyles: ['Local'] };
        // [*] Local = suggestion plus Local.Extra = error: per-rule wins in the same section.
        global = ruleStateFor('reply.reply', resolvedWith({ ...base, RuleToLevel: { Local: 'suggestion', 'Local.Extra': 'error' } }), inventory, []);
        // [*] Local.Extra = warning; [*.reply] Local = suggestion: the narrower section wins.
        narrowerStyle = ruleStateFor(
          'reply.reply',
          resolvedWith({ ...base, RuleToLevel: { 'Local.Extra': 'warning' }, SLevels: { '*.reply': { Local: 'suggestion' } } }),
          inventory,
          ['*.reply']
        );
        // [*.reply] Local.Extra = warning; [reply.*] Local = suggestion: a section rule level beats a later section style level.
        sectionRuleOverLaterSectionStyle = ruleStateFor(
          'reply.reply',
          resolvedWith({ ...base, SLevels: { '*.reply': { 'Local.Extra': 'warning' }, 'reply.*': { Local: 'suggestion' } } }),
          inventory,
          ['*.reply', 'reply.*']
        );
        // [*] Local = suggestion; [*.reply] Local.Extra = warning: the narrower section wins.
        narrowerRule = ruleStateFor(
          'reply.reply',
          resolvedWith({ ...base, RuleToLevel: { Local: 'suggestion' }, SLevels: { '*.reply': { 'Local.Extra': 'warning' } } }),
          inventory,
          ['*.reply']
        );
      });

      it('should resolve levels the way Vale does', () => {
        expect({
          global: [global.get('Local.Extra').level, global.get('Local.Other').level],
          narrowerStyle: [narrowerStyle.get('Local.Extra').level, narrowerStyle.get('Local.Other').level],
          narrowerRule: [narrowerRule.get('Local.Extra').level, narrowerRule.get('Local.Other').level],
          sectionRuleOverLaterSectionStyle: [
            sectionRuleOverLaterSectionStyle.get('Local.Extra').level,
            sectionRuleOverLaterSectionStyle.get('Local.Other').level
          ]
        }).toEqual({
          global: ['error', 'suggestion'],
          narrowerStyle: ['suggestion', 'suggestion'],
          narrowerRule: ['warning', 'suggestion'],
          sectionRuleOverLaterSectionStyle: ['warning', 'suggestion']
        });
      });
    });
  });

  describe('contextRules', () => {
    describe('when vale cannot report the config, or the probe already failed', () => {
      let failed, junk, skipped, spawns;

      beforeEach(() => {
        valeSays(null);
        failed = contextRules(DEFAULTS, os.tmpdir(), {});
        valeSays('nope');
        junk = contextRules(DEFAULTS, os.tmpdir(), {});
        const before = mockSpawnSync.mock.calls.length;
        skipped = contextRules(DEFAULTS, os.tmpdir(), {}, { vale: false });
        spawns = mockSpawnSync.mock.calls.length - before;
      });

      it('should return the plain condensed text every time, without spawning for a known-missing vale', () => {
        expect({ same: failed === junk && junk === skipped, spawns }).toEqual({ same: true, spawns: 0 });
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
          'JustSaySo.NegativeParallelism': 'error',
          'acme.Alpha': 'error',
          'acme.Beta': 'error',
          'acme.Gamma': 'warning',
          'acme.Delta': 'error',
          'soft.Loud': 'error'
        });
        const project = iniFile(
          'StylesPath = styles\n[*]\nBasedOnStyles = JustSaySo, acme, soft\n[{*.reply,*.publish}]\nJustSaySo.NegativeParallelism = NO\n',
          dir
        );
        valeSays(
          resolvedWith({
            GBaseStyles: ['JustSaySo', 'acme', 'soft'],
            GChecks: { 'JustSaySo.Intensifiers': false, 'acme.Delta': false },
            RuleToLevel: { soft: 'warning' },
            SChecks: { '{*.reply,*.publish}': { 'JustSaySo.NegativeParallelism': false } },
            Paths: [dir],
            ConfigFiles: [project]
          })
        );
        text = contextRules(DEFAULTS, os.tmpdir(), {});
      });

      it('should drop the two bullets, keep bullets with only uninstalled rules, and name the undescribed error rules', () => {
        expect(text).not.toContain('Empty intensifiers');
        expect(text).not.toContain("it's not {x}");
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
