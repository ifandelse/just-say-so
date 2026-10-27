import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectedStyles, adviceInputs, formatAdvice } from './advise.js';

/*
 * Branch map — src/lib/advise.js
 *   selectedStyles: [*] list · a matching section's list replaces it · a
 *     non-matching section is skipped
 *   adviceInputs: projects from the situations, (none) left out · a project
 *     vale cannot read · named rules with installed/on/off/level · the
 *     shortlist pool is installed rules plus cached rules of packages not
 *     installed, an installed id listed once · registry packages not
 *     installed, by style name, Packages name, or Packages URL · cached
 *     flag · cache line empty, filled, stale
 *   formatAdvice: nothing to advise · a project with every section, the
 *     typed reasons per tag included · empty candidates say what that means
 */

const REGISTRY = [
  { name: 'ai-tells', description: 'AI tells.', homepage: 'h', url: 'https://github.com/tbhb/vale-ai-tells/releases/latest/download/ai-tells.zip', tags: ['style'] },
  { name: 'Voices', description: 'Voices.', homepage: 'h', url: 'https://x/Voices.zip', tags: ['style'] },
  { name: 'Google', description: 'Google.', homepage: 'h', url: 'https://x/Google.zip', tags: ['style'] },
  { name: 'Microsoft', description: 'MS.', homepage: 'h', url: 'https://github.com/vale-cli/Microsoft/releases/latest/download/Microsoft.zip', tags: ['style'] },
  { name: 'Hugo', description: 'Hugo.', homepage: 'h', url: 'https://x/Hugo.zip', tags: ['config'] }
];
const CACHE = [
  { name: 'ai-tells', url: 'u', fetched: '2026-10-01T00:00:00.000Z', rules: [{ id: 'ai-tells.MicDrop', level: 'error', extends: 'existence', message: 'cached copy', description: null, link: null, sample: [] }] },
  { name: 'Voices', url: 'u', fetched: '2026-10-02T00:00:00.000Z', rules: [{ id: 'Human.Closers', level: 'warning', extends: 'existence', message: "Closer: '%s'. End on the last point.", description: null, link: null, sample: [] }] }
];
const situation = (project, tag, kind, over = {}) => ({
  kind, project, tag, count: 3, rules: [], short: false, linted: 0, fired: 0, joinedLinted: 0, firedAtShip: 0, modes: {}, levels: [], reasons: [], ...over
});

describe('advise', () => {
  describe('selectedStyles', () => {
    it('should start from [*] and let a matching section replace the list', () => {
      const resolved = { GBaseStyles: ['A'], SBaseStyles: { '*.reply': ['B', 'C'], '*.md': ['D'] } };
      expect(selectedStyles('reply.reply', resolved, ['*.md', '*.reply'])).toEqual(['B', 'C']);
      expect(selectedStyles('x.md', resolved, ['*.md', '*.reply'])).toEqual(['D']);
      expect(selectedStyles('x.txt', resolved, ['*.md'])).toEqual(['A']);
    });
  });

  describe('when two projects have situations and one cannot run vale', () => {
    let inputs, text, env;

    beforeEach(() => {
      env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-advise-')) };
      const facts = (project) => {
        if (project === '/p/a') return { project, vale: false, configPath: '/p/a/.vale.ini', packages: [], styles: [], installed: [], state: new Map() };
        return {
          project,
          vale: true,
          configPath: '/p/b/.vale.ini',
          packages: ['https://github.com/vale-cli/Microsoft/releases/latest/download/Microsoft.zip', 'google'],
          styles: ['JustSaySo', 'ai-tells'],
          installed: [
            { id: 'ai-tells.MicDrop', level: 'error', extends: 'existence', message: "AI mic-drop: '%s'. Cut it.", description: null, link: null, sample: [], enabled: true, installed: true, package: 'ai-tells' },
            { id: 'JustSaySo.Leverage', level: 'error', extends: 'existence', message: 'Banned: leverage.', description: null, link: null, sample: [], enabled: false, installed: true, package: 'JustSaySo' }
          ],
          state: new Map([
            ['ai-tells.MicDrop', { enabled: true, level: 'error', addressed: true }],
            ['JustSaySo.Leverage', { enabled: false, level: 'error', addressed: true }]
          ])
        };
      };
      const report = {
        situations: [
          situation('(none)', 'lost', 'uncovered'),
          situation('/p/a', 'plain', 'uncovered', { reasons: ['no vale here'] }),
          situation('/p/b', 'end-with-fact', 'fired-shipped', { rules: ['ai-tells.MicDrop', 'ai-tells.Gone'], linted: 3, fired: 3, joinedLinted: 3, firedAtShip: 2, modes: { warn: 2 }, levels: ['error'], reasons: ['ends with a mic drop closer'] }),
          situation('/p/b', 'zzz', 'uncovered', { reasons: ['qqq'] }),
          situation('/p/b', null, 'untagged-clean', { count: 1, reasons: [null] })
        ]
      };
      inputs = adviceInputs(report, { registry: REGISTRY, cache: CACHE, env, facts, now: new Date('2026-11-15T00:00:00Z') });
      text = formatAdvice(inputs);
    });

    it('should build the inputs per project from the facts, the cache, and the registry', () => {
      expect(inputs.cache).toEqual({ dir: path.join(env.JUST_SAY_SO_STATE_DIR, 'packages'), packages: 0, rules: 0, oldest: null, newest: null, ageDays: null, missing: 4, available: 4 });
      expect(inputs.projects.map((p) => [p.project, p.vale, p.packages, p.replyStyles])).toEqual([
        ['/p/a', false, [], []],
        ['/p/b', true, ['https://github.com/vale-cli/Microsoft/releases/latest/download/Microsoft.zip', 'google'], ['JustSaySo', 'ai-tells']]
      ]);
      const b = inputs.projects[1];
      expect(b.tags).toEqual([
        {
          tag: 'end-with-fact',
          kind: 'fired-shipped',
          reasons: ['ends with a mic drop closer'],
          named: [
            { id: 'ai-tells.MicDrop', installed: true, enabled: true, level: 'error' },
            { id: 'ai-tells.Gone', installed: false, enabled: false, level: null }
          ],
          candidates: [
            { id: 'Human.Closers', package: 'Voices', installed: false, enabled: false, level: 'warning', message: "Closer: '%s'. End on the last point.", score: 3, matched: ['closer', 'end'] },
            { id: 'ai-tells.MicDrop', package: 'ai-tells', installed: true, enabled: true, level: 'error', message: "AI mic-drop: '%s'. Cut it.", score: 2, matched: ['drop', 'mic'] }
          ]
        },
        { tag: 'zzz', kind: 'uncovered', reasons: ['qqq'], named: [], candidates: [] }
      ]);
      expect(b.notInstalled).toEqual([{ name: 'Voices', description: 'Voices.', homepage: 'h', cached: false }]);
      expect(b.situations.map((s) => s.kind)).toEqual(['fired-shipped', 'uncovered', 'untagged-clean']);
    });

    it('should render the inputs as text', () => {
      expect(text).toContain('package cache: empty. The registry lists 4 style packages;');
      expect(text).toContain('Project /p/a\n  vale could not read /p/a/.vale.ini; rule states and installed rules are unknown here.');
      expect(text).toContain('vale config /p/b/.vale.ini · packages: https://github.com/vale-cli/Microsoft/releases/latest/download/Microsoft.zip, google · reply BasedOnStyles: JustSaySo, ai-tells');
      expect(text).toContain('  #end-with-fact · reasons typed: ends with a mic drop closer\n  #end-with-fact · rules the bullet names, as the reply target sees them: ai-tells.MicDrop (on, error); ai-tells.Gone (not installed)');
      expect(text).toContain('  #zzz · reasons typed: qqq\n');
      expect(text).toContain("    ai-tells.MicDrop [installed, on, error] 2 (drop, mic) · AI mic-drop: '%s'. Cut it.");
      expect(text).toContain("    Human.Closers [cached from Voices, not installed] 3 (closer, end) · Closer: '%s'. End on the last point.");
      expect(text).toContain("#zzz · candidates: none found by word overlap with the tag and its reasons. That is this search's limit");
      expect(text).toContain('Registry packages this project does not have (0 of 1 cached):\n    Voices (not cached): Voices.');
      expect(text).toContain('More packages outside the registry: https://github.com/topics/vale-linter-style');
    });
  });

  describe('when nothing reached the threshold', () => {
    it('should say so', () => {
      const env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-advise-')) };
      const inputs = adviceInputs({ situations: [] }, { registry: REGISTRY, cache: [], env, facts: () => { throw new Error('not called'); } });
      expect(formatAdvice(inputs)).toBe(
        'just-say-so advice inputs\n  package cache: empty. The registry lists 4 style packages; suggestions for packages you do not have come from their one-line descriptions only. Run /just-say-so:packages --refresh to match against their rules.\n\nNo tag reached 3 rejections in one project, and no untagged clean rejections. Nothing to advise on yet; keep tagging with /just-say-so:restate #tag.\n'
      );
    });
  });

  describe('when the cache is filled and old', () => {
    it('should print its size and age', () => {
      const env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-advise-')) };
      fs.mkdirSync(path.join(env.JUST_SAY_SO_STATE_DIR, 'packages'));
      for (const pkg of CACHE) fs.writeFileSync(path.join(env.JUST_SAY_SO_STATE_DIR, 'packages', `${pkg.name}.json`), JSON.stringify(pkg));
      const inputs = adviceInputs({ situations: [] }, { registry: REGISTRY, cache: CACHE, env, now: new Date('2026-11-15T00:00:00Z') });
      expect(formatAdvice(inputs)).toContain('package cache: 2 packages, 2 rules, fetched 2026-10-01T00:00:00.000Z to 2026-10-02T00:00:00.000Z. 2 registry packages are not cached. The oldest is 45 days old; /just-say-so:packages --refresh updates it.');
    });
  });
});
