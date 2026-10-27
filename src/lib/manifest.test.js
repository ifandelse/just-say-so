import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  loadExtra,
  renderRules,
  valeIds,
  styleSpecs,
  fixedTerms,
  dropInReplacement,
  shippedManifestPath
} from './manifest.js';

/*
 * Branch map — src/lib/manifest.js
 *   loadManifest: shipped · rules.manifest override (tilde expanded) ·
 *     relative paths resolve against the project directory ·
 *     rules.extra appends sections and the ids with a short text ·
 *     malformed extra ignored
 *   renderRules condensed: title, intro, the ids in order, rules without
 *     short skipped, drop honored, append added
 *   renderRules full: sections with note, prose sections, Checked by for
 *     tagged rules, drop honored
 *   {terms}: quoted run with the comma inside · plain comma list · drop-in
 *     hint in parentheses · prose hint omitted
 *   valeIds deduplicates · styleSpecs in order · fixedTerms lists terms
 *   drift: rules/full.md and rules/condensed.md equal the render
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-manifest-'));
}

const SMALL = {
  title: 'House rules',
  intro: 'Apply everywhere.',
  condensed: ['lead', 'words', 'frames', 'missing-id'],
  sections: [
    {
      title: 'Shape',
      note: 'A note.',
      rules: [
        { id: 'lead', full: 'Lead with it.', short: 'Lead.', vale: [] },
        { id: 'long', full: 'Keep it short.', vale: ['STE.SentenceLength', 'STE.SentenceLength'] }
      ]
    },
    {
      title: 'Words',
      rules: [
        {
          id: 'words',
          full: 'Banned: {terms}.',
          short: 'Banned: {terms}.',
          vale: ['JustSaySo.Words'],
          style: {
            name: 'Words',
            message: 'Banned: %s.',
            level: 'error',
            terms: [{ term: 'flumox' }, { term: 'utilize', hint: 'use "use"' }, { term: 'leverage', hint: 'use a verb' }]
          }
        },
        {
          id: 'frames',
          full: 'Frames: {terms}.',
          short: 'Frames: {terms}.',
          vale: ['JustSaySo.Frames'],
          style: {
            name: 'Frames',
            message: 'Frame: %s.',
            level: 'warning',
            terms: [{ term: 'It is important to note', quote: true }, { term: 'In order to', quote: true, hint: 'use "to"' }]
          }
        }
      ]
    },
    { title: 'Last', prose: true, rules: [{ id: 'final', full: 'Delete filler.', vale: ['ai-tells.EmptyPadding'] }] }
  ]
};

describe('manifest', () => {
  describe('loadManifest', () => {
    describe('when nothing is configured', () => {
      let manifest;

      beforeEach(() => {
        manifest = loadManifest({});
      });

      it('should load the shipped manifest', () => {
        expect(manifest.title).toBe('Communication rules');
        expect(manifest.sections.map((s) => s.title)).toEqual([
          'Precision first',
          'Sentence and paragraph mechanics',
          'Banned',
          'Final check'
        ]);
      });
    });

    describe('when rules.manifest names a file under a tilde', () => {
      let thrown;

      beforeEach(() => {
        try {
          loadManifest({ rules: { manifest: '~/MISSING_JSS_MANIFEST_8675309.json' } });
        } catch (e) {
          thrown = e;
        }
      });

      it('should expand the tilde before reading', () => {
        expect(thrown.path).toBe(path.join(os.homedir(), 'MISSING_JSS_MANIFEST_8675309.json'));
      });
    });

    describe('when rules.manifest and rules.extra are both set', () => {
      let manifest;

      beforeEach(() => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify(SMALL));
        fs.writeFileSync(
          path.join(dir, 'x.json'),
          JSON.stringify({
            sections: [
              {
                title: 'Project',
                rules: [
                  { id: 'dash', full: 'No em-dashes.', short: 'No em-dashes.', vale: ['ai-tells.EmDashUsage'] },
                  { id: 'quiet', full: 'Full only.', vale: [] }
                ]
              }
            ]
          })
        );
        manifest = loadManifest({ rules: { manifest: path.join(dir, 'm.json'), extra: path.join(dir, 'x.json') } });
      });

      it('should append the extra sections and the ids that have a short text', () => {
        expect({ titles: manifest.sections.map((s) => s.title), condensed: manifest.condensed }).toEqual({
          titles: ['Shape', 'Words', 'Last', 'Project'],
          condensed: ['lead', 'words', 'frames', 'missing-id', 'dash']
        });
      });
    });

    describe('when the rule files are named by paths relative to the project', () => {
      let fromElsewhere, extra;

      beforeEach(() => {
        const dir = tmpdir();
        fs.mkdirSync(path.join(dir, 'rules'));
        fs.writeFileSync(path.join(dir, 'rules', 'm.json'), JSON.stringify(SMALL));
        fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ sections: [{ title: 'Project', rules: [{ id: 'extra', full: 'x', vale: [] }] }] }));
        const config = { rules: { manifest: 'rules/m.json', extra: './x.json' } };
        fromElsewhere = loadManifest(config, dir);
        extra = loadExtra(config, dir);
      });

      it('should resolve both against the project directory, not the launch directory', () => {
        expect(fromElsewhere.sections.map((s) => s.title)).toEqual(['Shape', 'Words', 'Last', 'Project']);
        expect(extra.sections[0].rules[0].id).toBe('extra');
      });
    });

    describe('when rules.extra is malformed', () => {
      let manifest;

      beforeEach(() => {
        const dir = tmpdir();
        fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify(SMALL));
        fs.writeFileSync(path.join(dir, 'x.json'), '{oops');
        manifest = loadManifest({ rules: { manifest: path.join(dir, 'm.json'), extra: path.join(dir, 'x.json') } });
      });

      it('should ignore it', () => {
        expect(manifest).toEqual(SMALL);
      });
    });
  });

  describe('loadExtra', () => {
    it('should return the fragment alone, or null when unset or unreadable', () => {
      const dir = tmpdir();
      fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify({ sections: [] }));
      fs.writeFileSync(path.join(dir, 'bad.json'), '{oops');
      expect({
        set: loadExtra({ rules: { extra: path.join(dir, 'x.json') } }),
        unset: loadExtra({}),
        bad: loadExtra({ rules: { extra: path.join(dir, 'bad.json') } })
      }).toEqual({ set: { sections: [] }, unset: null, bad: null });
    });
  });

  describe('renderRules', () => {
    describe('when rendering the condensed reminder with a drop and an append', () => {
      let text;

      beforeEach(() => {
        text = renderRules(SMALL, 'condensed', { drop: new Set(['frames']), append: 'Also: X.' });
      });

      it('should list the ids in order, skip dropped and unknown ids, and close with the append', () => {
        expect(text).toBe(
          ['## House rules — reminder', '', 'Apply everywhere.', '', '- Lead.', '- Banned: flumox, utilize (use "use"), leverage.', '', 'Also: X.', ''].join('\n')
        );
      });
    });

    describe('when rendering the full text', () => {
      let text;

      beforeEach(() => {
        text = renderRules(SMALL, 'full', { drop: new Set(['long']) });
      });

      it('should render sections, notes, prose sections, quoted term runs, and the Checked by trailer', () => {
        expect(text).toBe(
          [
            '## House rules',
            '',
            'Apply everywhere.',
            '',
            '### Shape',
            '',
            'A note.',
            '',
            '- Lead with it.',
            '',
            '### Words',
            '',
            '- Banned: flumox, utilize (use "use"), leverage. Checked by JustSaySo.Words.',
            '- Frames: "It is important to note," "In order to" (use "to"). Checked by JustSaySo.Frames.',
            '',
            '### Last',
            '',
            'Delete filler. Checked by ai-tells.EmptyPadding.',
            ''
          ].join('\n')
        );
      });
    });
  });

  describe('valeIds, styleSpecs, fixedTerms, dropInReplacement', () => {
    describe('when read from the small manifest', () => {
      let result;

      beforeEach(() => {
        result = {
          ids: valeIds(SMALL),
          specs: styleSpecs(SMALL).map((s) => s.name),
          terms: fixedTerms(SMALL),
          hints: ['use "to"', 'use a verb', undefined].map(dropInReplacement)
        };
      });

      it('should deduplicate ids, keep spec order, list every term, and read drop-in hints only', () => {
        expect(result).toEqual({
          ids: ['STE.SentenceLength', 'JustSaySo.Words', 'JustSaySo.Frames', 'ai-tells.EmptyPadding'],
          specs: ['Words', 'Frames'],
          terms: ['flumox', 'utilize', 'leverage', 'It is important to note', 'In order to'],
          hints: ['to', null, null]
        });
      });
    });
  });

  describe('when the committed rules files are compared to the render', () => {
    let manifest, full, condensed;

    beforeEach(() => {
      manifest = JSON.parse(fs.readFileSync(shippedManifestPath(), 'utf8'));
      full = fs.readFileSync(path.join(ROOT, 'rules', 'full.md'), 'utf8');
      condensed = fs.readFileSync(path.join(ROOT, 'rules', 'condensed.md'), 'utf8');
    });

    it('should match — run npm run build after editing rules/manifest.json', () => {
      expect({ full, condensed }).toEqual({
        full: renderRules(manifest, 'full'),
        condensed: renderRules(manifest, 'condensed')
      });
    });

    it('should name every generated JustSaySo rule and no other', () => {
      const generated = fs
        .readdirSync(path.join(ROOT, 'styles', 'JustSaySo'))
        .map((f) => `JustSaySo.${f.replace(/\.yml$/, '')}`)
        .sort();
      const named = valeIds(manifest)
        .filter((id) => id.startsWith('JustSaySo.'))
        .sort();
      expect(named).toEqual(generated);
    });
  });
});
