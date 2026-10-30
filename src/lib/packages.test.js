import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARK_BEGIN,
  MARK_END,
  PROSE_GLOB,
  readPackages,
  styleNames,
  ruleSettingLines,
  renderValeSections,
  spliceGenerated,
  styleEntries,
  vendoredRuleIds
} from './packages.js';
import { checkedTerms, shippedManifestPath } from './manifest.js';

function readManifest() {
  return JSON.parse(fs.readFileSync(shippedManifestPath(), 'utf8'));
}

/*
 * Branches:
 *   ruleSettingLines: NO and a level · an invalid value throws
 *   renderValeSections: the three sections, settings only under [*]
 *   spliceGenerated: both markers · a marker missing · markers reversed
 *   styleEntries: complete package layout · bare style layout · other files skipped
 *   vendoredRuleIds: directory present · directory missing
 *   the shipped file: every rule it sets exists in the vendored styles, and
 *   the committed configs carry the rendered block
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SMALL = {
  packages: [{ name: 'acme' }, { name: 'STE' }],
  rules: { 'acme.Zed': 'suggestion', 'STE.Alpha': 'NO' }
};

describe('packages', () => {
  describe('ruleSettingLines and styleNames', () => {
    describe('when the file sets a NO and a level', () => {
      let lines, names;

      beforeEach(() => {
        lines = ruleSettingLines(SMALL);
        names = styleNames(SMALL);
      });

      it('should sort the lines by id and put JustSaySo first in the style list', () => {
        expect({ lines, names }).toEqual({
          lines: ['STE.Alpha = NO', 'acme.Zed = suggestion'],
          names: ['JustSaySo', 'acme', 'STE']
        });
      });
    });

    describe('when a rule is set to a value Vale does not take', () => {
      let error;

      beforeEach(() => {
        try {
          ruleSettingLines({ rules: { 'acme.Zed': 'off' } });
        } catch (e) {
          error = e;
        }
      });

      it('should throw naming the rule and the value', () => {
        expect(error.message).toContain('acme.Zed is set to "off"');
      });
    });
  });

  describe('renderValeSections', () => {
    let block;

    beforeEach(() => {
      block = renderValeSections(SMALL, { codeRules: ['acme.Zed', 'acme.Words', 'acme.Words'] });
    });

    it('should render the markers, JustSaySo with the code rules and settings under [*], and the prose section', () => {
      expect(block).toBe(
        [
          MARK_BEGIN,
          '[*]',
          'BasedOnStyles = JustSaySo',
          'acme.Words = YES',
          'acme.Zed = YES',
          'STE.Alpha = NO',
          'acme.Zed = suggestion',
          '',
          `[${PROSE_GLOB}]`,
          'BasedOnStyles = JustSaySo, acme, STE',
          '',
          MARK_END
        ].join('\n')
      );
    });
  });

  describe('spliceGenerated', () => {
    describe('when the text carries both markers', () => {
      let out;

      beforeEach(() => {
        out = spliceGenerated(`head\n${MARK_BEGIN}\nold\n${MARK_END}\ntail\n`, `${MARK_BEGIN}\nnew\n${MARK_END}`);
      });

      it('should replace the block and keep the text around it', () => {
        expect(out).toBe(`head\n${MARK_BEGIN}\nnew\n${MARK_END}\ntail\n`);
      });
    });

    describe('when a marker is missing or the markers are reversed', () => {
      let missing, reversed;

      beforeEach(() => {
        try {
          spliceGenerated(`head\n${MARK_BEGIN}\n`, 'x');
        } catch (e) {
          missing = e;
        }
        try {
          spliceGenerated(`${MARK_END}\n${MARK_BEGIN}\n`, 'x');
        } catch (e) {
          reversed = e;
        }
      });

      it('should throw both times', () => {
        expect([missing.message, reversed.message].map((m) => m.includes('no "# --- generated'))).toEqual([true, true]);
      });
    });
  });

  describe('styleEntries', () => {
    describe('when the archive is a complete package with a config directory beside the style', () => {
      let files;

      beforeEach(() => {
        files = styleEntries(
          [
            { name: 'ai-tells/styles/ai-tells/MicDrop.yml', data: Buffer.from('a') },
            { name: 'ai-tells/styles/ai-tells/sub/Deep.yml', data: Buffer.from('b') },
            { name: 'ai-tells/styles/config/templates/x.tmpl', data: Buffer.from('c') },
            { name: 'ai-tells/.vale.ini', data: Buffer.from('d') },
            { name: 'ai-tells/styles/other/Rule.yml', data: Buffer.from('e') }
          ],
          'ai-tells'
        );
      });

      it('should take the style directory alone, nested files included', () => {
        expect(files.map((f) => [f.rel, f.data.toString()])).toEqual([
          ['MicDrop.yml', 'a'],
          ['sub/Deep.yml', 'b']
        ]);
      });
    });

    describe('when the archive is a bare style', () => {
      let files;

      beforeEach(() => {
        files = styleEntries(
          [
            { name: 'STE/Articles.yml', data: Buffer.from('a') },
            { name: 'README.md', data: Buffer.from('b') }
          ],
          'STE'
        );
      });

      it('should take the files under the style name', () => {
        expect(files.map((f) => f.rel)).toEqual(['Articles.yml']);
      });
    });
  });

  describe('vendoredRuleIds', () => {
    let present, missing;

    beforeEach(() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-pk-'));
      fs.mkdirSync(path.join(dir, 'acme'));
      fs.writeFileSync(path.join(dir, 'acme', 'Zed.yml'), 'extends: existence\n');
      fs.writeFileSync(path.join(dir, 'acme', 'Alpha.yml'), 'extends: existence\n');
      fs.writeFileSync(path.join(dir, 'acme', 'notes.txt'), 'x');
      present = vendoredRuleIds(dir, 'acme');
      missing = vendoredRuleIds(dir, 'none');
    });

    it('should list the yml files as sorted ids and nothing for an absent style', () => {
      expect({ present, missing }).toEqual({ present: ['acme.Alpha', 'acme.Zed'], missing: [] });
    });
  });

  describe('when the shipped file is compared to the vendored styles and the committed configs', () => {
    let packages, unknownSettings, counts, fallback, repoIni, block;

    beforeEach(() => {
      packages = readPackages();
      const stylesDir = path.join(ROOT, 'styles');
      const ids = new Set(packages.packages.flatMap((p) => vendoredRuleIds(stylesDir, p.name)));
      unknownSettings = Object.keys(packages.rules).filter((id) => !ids.has(id));
      counts = packages.packages.map((p) => [p.name, vendoredRuleIds(stylesDir, p.name).length, p.ruleCount]);
      block = renderValeSections(packages, { codeRules: checkedTerms(readManifest()).map((t) => t.checkedBy) });
      fallback = fs.readFileSync(path.join(ROOT, 'vale', 'fallback.ini'), 'utf8');
      repoIni = fs.readFileSync(path.join(ROOT, '.vale.ini'), 'utf8');
    });

    it('should set only rules the vendored styles define, at the recorded counts', () => {
      expect({ unknownSettings, counts }).toEqual({
        unknownSettings: [],
        counts: packages.packages.map((p) => [p.name, p.ruleCount, p.ruleCount])
      });
    });

    it('should carry the rendered block in both configs — run npm run build after editing rules/packages.json', () => {
      expect({ fallback: fallback.includes(block), repo: repoIni.includes(block) }).toEqual({ fallback: true, repo: true });
    });
  });
});
