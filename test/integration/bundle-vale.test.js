import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintPath } from '../../src/lib/vale.js';
import { addAllowTerm } from '../../src/lib/allow.js';
import { MARK_BEGIN, MARK_END } from '../../src/lib/packages.js';

/*
 * Integration: the shipped fallback config and the bundled styles against
 * real Vale. Each case is a behavior the 0.19.0 review found wrong once:
 *   the generated JustSaySo rules still catch an imperative "Leverage"
 *     in Markdown and a banned term in a code comment, and no bundled
 *     rule reports a code comment
 *   two rules on one span fold to the JustSaySo alert
 *   a project [*.md] section that restates BasedOnStyles drops the bundle
 *   allow measures which rules an entry silences: a sequence rule keeps
 *     reporting and is named as such, and a word rule goes quiet
 * Skipped when no usable vale is on PATH, so the unit suite stays hermetic.
 */

const HAVE_VALE = spawnSync('vale', ['ls-dirs'], { encoding: 'utf8' }).status === 0;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FALLBACK = path.join(ROOT, 'vale', 'fallback.ini');

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-bundle-')));
}

// The fallback's generated block, as a project config would get it from
// the package: a styles directory that links the plugin's styles and
// holds the project vocabulary.
function projectIni(dir, extra = '') {
  const text = fs.readFileSync(FALLBACK, 'utf8');
  const block = text.slice(text.indexOf(MARK_BEGIN), text.indexOf(MARK_END) + MARK_END.length);
  const styles = path.join(dir, 'styles');
  fs.mkdirSync(path.join(styles, 'config', 'vocabularies', 'Project'), { recursive: true });
  fs.writeFileSync(path.join(styles, 'config', 'vocabularies', 'Project', 'accept.txt'), '');
  for (const style of ['JustSaySo', 'ai-tells', 'STE']) fs.symlinkSync(path.join(ROOT, 'styles', style), path.join(styles, style));
  const ini = path.join(dir, '.vale.ini');
  fs.writeFileSync(ini, `StylesPath = styles\nMinAlertLevel = suggestion\nVocab = Project\n[formats]\nreply = md\npublish = md\n${block}\n${extra}`);
  return ini;
}

const summary = (alerts) => alerts.map((a) => `${a.Line}:${a.Check}:${a.Match}`);

describe.skipIf(!HAVE_VALE)('the bundled styles under real Vale', () => {
  describe('when prose and a code comment hold banned terms', () => {
    let md, js;

    beforeAll(() => {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, 'a.md'), 'Leverage the cache.\n\nWe leverage robust infrastructure.\n');
      fs.writeFileSync(path.join(dir, 'a.js'), '// We implement the parser here. We leverage robust infrastructure. Terminate it.\nconst x = 1;\n');
      md = lintPath(path.join(dir, 'a.md'), { configPath: FALLBACK });
      js = lintPath(path.join(dir, 'a.js'), { configPath: FALLBACK });
    });

    it('should catch the imperative in Markdown, fold the double reports, and keep code on the banned list alone', () => {
      expect(summary(md)).toEqual(['1:JustSaySo.Leverage:Leverage', '3:JustSaySo.Leverage:leverage', '3:JustSaySo.Buzzwords:robust']);
      expect(summary(js)).toEqual(['1:JustSaySo.Leverage:leverage', '1:JustSaySo.Buzzwords:robust']);
    });
  });

  describe('when a project restates BasedOnStyles for Markdown', () => {
    let alerts;

    beforeAll(() => {
      const dir = tmp();
      const ini = projectIni(dir, '[*.md]\nBasedOnStyles = JustSaySo\n');
      fs.writeFileSync(path.join(dir, 'a.md'), 'We leverage robust infrastructure. Nothing surfaced.\n');
      alerts = lintPath(path.join(dir, 'a.md'), { configPath: ini });
    });

    it('should drop the bundled styles for that format', () => {
      expect(summary(alerts)).toEqual(['1:JustSaySo.Leverage:leverage', '1:JustSaySo.Buzzwords:robust']);
    });
  });

  describe('when allow is given a term a sequence rule and a word rule both report', () => {
    let result, after;

    beforeAll(() => {
      const dir = tmp();
      const ini = projectIni(dir);
      // The first lint folds the sequence rule's alert into JustSaySo's on
      // the same span. The re-lint after the write is what exposes it.
      const env = { ...process.env, JUST_SAY_SO_STATE_DIR: path.join(dir, 'state'), JUST_SAY_SO_CONFIG: path.join(dir, 'none.json') };
      result = addAllowTerm('We leverage robust infrastructure.', dir, env);
      fs.writeFileSync(path.join(dir, 'reply.reply'), 'We leverage robust infrastructure.\n');
      after = lintPath(path.join(dir, 'reply.reply'), { configPath: ini });
    });

    it('should keep the entry for the word rules, name the sequence rule as unreachable, and match the re-lint', () => {
      expect({ written: result.written, honoured: result.honoured, unreachable: result.unreachable.map((r) => [r.id, r.reason]) }).toEqual({
        written: true,
        honoured: ['JustSaySo.Leverage', 'JustSaySo.Buzzwords'],
        unreachable: [['ai-tells.OverusedVocabularyVerbs', 'sequence']]
      });
      expect(summary(after)).toEqual(['1:ai-tells.OverusedVocabularyVerbs:leverage']);
    });
  });
});
