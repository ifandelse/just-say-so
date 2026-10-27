import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ruleStateFor, sectionOrder } from '../../src/lib/rule-state.js';
import { listStyleRules } from '../../src/lib/style-inventory.js';

/*
 * Integration: the resolver against real Vale. For each config, the rules
 * Vale runs on reply.reply (with their severities) must equal the rules
 * the resolver marks enabled (with their levels). Skipped when no usable
 * vale is on PATH, so the unit suite stays hermetic. Add a case here for
 * every precedence question; the comment names what it settles.
 */

const HAVE_VALE = spawnSync('vale', ['ls-dirs'], { encoding: 'utf8' }).status === 0;
const HEADER = 'StylesPath = styles\nMinAlertLevel = suggestion\n[formats]\nreply = md\n';

const CASES = {
  // A later style YES clears an earlier per-rule NO.
  ruleNoThenStyleYes: '[*]\nBasedOnStyles = Local\nLocal.Extra = NO\n[*.reply]\nLocal = YES\n',
  // A later style NO excludes an earlier per-rule YES.
  ruleYesThenStyleNo: '[*]\nBasedOnStyles = Local\nLocal.Extra = YES\n[*.reply]\nLocal = NO\n',
  // A later empty list drops an earlier per-rule YES.
  ruleYesThenEmptyList: '[*]\nBasedOnStyles = Local\nLocal.Extra = YES\n[*.reply]\nBasedOnStyles =\n',
  // A later restated list keeps an earlier per-rule NO.
  ruleNoThenList: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = NO\n[reply.*]\nBasedOnStyles = Local\n',
  // A later restated list keeps an earlier style NO.
  styleNoThenList: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = NO\n[reply.*]\nBasedOnStyles = Local\n',
  // A per-rule YES after an empty list runs that rule alone, past an earlier style NO.
  styleNoThenEmptyListRuleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = NO\n[reply.*]\nBasedOnStyles =\nLocal.Extra = YES\n',
  // A per-rule YES then a per-rule NO then YES again.
  ruleNoThenRuleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = NO\n[reply.*]\nLocal.Extra = YES\n',
  // A list in the same section as a per-rule NO, then a later list.
  listAndRuleNoThenList: '[*]\nBasedOnStyles = Local\n[*.reply]\nBasedOnStyles = Local\nLocal.Extra = NO\n[reply.*]\nBasedOnStyles = Local\n',
  // A style YES never selects a style.
  unselectedStyleYes: '[*]\nLocal = YES\n',
  // A style NO then a later style YES on a selected style.
  styleNoThenStyleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = NO\n[reply.*]\nLocal = YES\n',
  // A style-wide level counts as YES but does not survive an empty list.
  styleLevelThenEmptyList: '[*]\nBasedOnStyles = Local\nLocal = suggestion\n[*.reply]\nBasedOnStyles =\n',
  // A per-rule YES in the same section as an empty list.
  emptyListWithRuleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nBasedOnStyles =\nLocal.Extra = YES\n',
  // Inside one section the per-rule setting wins over the style setting.
  styleNoWithRuleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = NO\nLocal.Extra = YES\n',
  // A later style-wide level re-enables a per-rule NO and re-levels.
  ruleNoThenStyleLevel: '[*]\nBasedOnStyles = Local\nLocal.Extra = NO\n[*.reply]\nLocal = suggestion\n',
  // A later style-wide level re-enables a style NO.
  styleNoThenStyleLevel: '[*]\nBasedOnStyles = Local\nLocal = NO\n[*.reply]\nLocal = suggestion\n',
  // Style toggles act only on selected styles.
  unselectedRuleYesThenStyleYes: '[*]\nBasedOnStyles =\nLocal.Extra = YES\n[*.reply]\nLocal = YES\n',
  unselectedRuleYesThenStyleNo: '[*]\nBasedOnStyles =\n[*.reply]\nLocal.Extra = YES\n[reply.*]\nLocal = NO\n',
  // Header forms keep their file position.
  commentedHeaderFirst: '[*]\nBasedOnStyles = Local\n[r*.reply] # first\nLocal.Other = NO\n[*.reply]\nLocal.Other = YES\n',
  classHeaderLast: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Other = YES\n[reply.[r]eply]\nLocal.Other = NO\n',
  braceSection: '[*]\nBasedOnStyles = Local\n[{*.reply,*.publish}]\nLocal.Other = NO\n',
  // No list anywhere: [*] settings are fallbacks a section's style mention overrides.
  noListGlobalRuleYesSectionStyleNo: '[*]\nLocal.Extra = YES\n[*.reply]\nLocal = NO\n',
  noListGlobalRuleNoSectionStyleYes: '[*]\nLocal.Extra = NO\n[*.reply]\nLocal = YES\n',
  noListGlobalStyleNoThenSectionList: '[*]\nLocal = NO\n[*.reply]\nBasedOnStyles = Local\n',
  noListSectionStyleYesAlone: '[*.reply]\nLocal = YES\n',
  // Among matching sections a per-rule setting beats a style setting in either order.
  sectionRuleNoThenSectionStyleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = NO\n[reply.*]\nLocal = YES\n',
  sectionRuleYesThenSectionStyleNo: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = YES\n[reply.*]\nLocal = NO\n',
  sectionStyleNoThenSectionRuleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = NO\n[reply.*]\nLocal.Extra = YES\n',
  sectionStyleYesThenSectionRuleNo: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = YES\n[reply.*]\nLocal.Extra = NO\n',
  sectionRuleNoThenStyleNoThenStyleYes: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = NO\n[reply.*]\nLocal = NO\n[r*.reply]\nLocal = YES\n',
  // A section setting beats a [*] setting of the other kind.
  globalStyleYesThenSectionRuleNo: '[*]\nBasedOnStyles = Local\nLocal = YES\n[*.reply]\nLocal.Extra = NO\n',
  globalStyleNoThenSectionRuleYes: '[*]\nBasedOnStyles = Local\nLocal = NO\n[*.reply]\nLocal.Extra = YES\n',
  // Levels follow the same precedence.
  sectionRuleLevelThenSectionStyleLevel: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal.Extra = warning\n[reply.*]\nLocal = suggestion\n',
  sectionStyleLevelThenSectionRuleLevel: '[*]\nBasedOnStyles = Local\n[*.reply]\nLocal = suggestion\n[reply.*]\nLocal.Extra = warning\n',
  globalStyleLevelThenSectionRuleLevel: '[*]\nBasedOnStyles = Local\nLocal = suggestion\n[*.reply]\nLocal.Extra = warning\n',
  // A narrower section's style-wide level beats a global per-rule level.
  sectionStyleLevelOverGlobalRuleLevel: '[*]\nBasedOnStyles = Local\nLocal.Extra = warning\n[*.reply]\nLocal = suggestion\n',
  // Inside one section a per-rule level beats a style-wide level.
  ruleLevelOverStyleLevel: '[*]\nBasedOnStyles = Local\nLocal = suggestion\nLocal.Extra = error\n'
};

describe.skipIf(!HAVE_VALE)('rule-state against real vale', () => {
  let dir, results;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rs-vale-'));
    fs.mkdirSync(path.join(dir, 'styles', 'Local'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'styles', 'Local', 'Extra.yml'), 'extends: existence\nmessage: "extra"\nlevel: error\ntokens: ["zzz"]\n');
    fs.writeFileSync(path.join(dir, 'styles', 'Local', 'Other.yml'), 'extends: existence\nmessage: "other"\nlevel: warning\ntokens: ["yyy"]\n');
    fs.writeFileSync(path.join(dir, 'reply.reply'), 'zzz yyy\n');
    results = {};
    for (const [name, body] of Object.entries(CASES)) {
      fs.writeFileSync(path.join(dir, '.vale.ini'), HEADER + body);
      const lint = spawnSync('vale', ['--output=JSON', 'reply.reply'], { cwd: dir, encoding: 'utf8' });
      const alerts = Object.values(JSON.parse(lint.stdout || '{}')).flat();
      const vale = Object.fromEntries(alerts.map((a) => [a.Check, a.Severity]).sort());
      const resolved = JSON.parse(spawnSync('vale', ['ls-config'], { cwd: dir, encoding: 'utf8' }).stdout);
      const state = ruleStateFor('reply.reply', resolved, listStyleRules(resolved.Paths), sectionOrder(resolved));
      const ours = Object.fromEntries(
        [...state.entries()]
          .filter(([, s]) => s.enabled)
          .map(([id, s]) => [id, s.level])
          .sort()
      );
      results[name] = { vale, ours };
    }
  });

  it('should enable the same rules at the same levels as vale for every case', () => {
    const disagreements = Object.fromEntries(
      Object.entries(results).filter(([, r]) => JSON.stringify(r.vale) !== JSON.stringify(r.ours))
    );
    expect(disagreements).toEqual({});
  });
});
