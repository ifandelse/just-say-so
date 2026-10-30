import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyleFiles, termPattern } from './style-gen.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('style-gen', () => {
  describe('termPattern', () => {
    describe('when given a word, a phrase, and a curly-quoted term', () => {
      let word, phrase, curly;

      beforeEach(() => {
        word = termPattern('robust');
        phrase = termPattern('load-bearing');
        curly = termPattern('it’s');
      });

      it('should bound the term by non-word characters and join phrase tokens with a flexible separator', () => {
        expect({ word, phrase, curly }).toEqual({
          word: '(?<![\\w-])robust(?![\\w-])',
          phrase: '(?<![\\w-])load[\\s\\u00A0-]+bearing(?![\\w-])',
          curly: "(?<![\\w-])it's(?![\\w-])"
        });
      });

      it('should match a hyphenated phrase but not the word inside an identifier', () => {
        expect({
          phrase: new RegExp(phrase, 'i').test('a LOAD BEARING wall'),
          hyphen: new RegExp(phrase, 'i').test('load-bearing'),
          ident: new RegExp(word, 'i').test('robust-websocket')
        }).toEqual({ phrase: true, hyphen: true, ident: false });
      });
    });
  });

  describe('buildStyleFiles', () => {
    describe('when the manifest has every term kind', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({
          sections: [
            {
              title: 'x',
              rules: [
                {
                  id: 'a',
                  vale: [],
                  style: {
                    name: 'Buzzwords',
                    message: "Banned buzzword: '%s'. Delete it.",
                    level: 'error',
                    terms: [
                      { term: 'flumoxide' },
                      { term: 'quuxly', checkedBy: 'acme.Quux' },
                      { term: 'calzone cannon' },
                      { term: 'utilize', hint: 'use "use"' },
                      { term: 'leverage', hint: 'use a concrete verb: use, apply, rely on' }
                    ]
                  }
                },
                {
                  id: 'b',
                  vale: [],
                  style: {
                    name: 'Frames',
                    message: "Banned frame: '%s'. State it.",
                    level: 'error',
                    terms: [{ term: 'In order to', quote: true, hint: 'use "to"' }],
                    patterns: [{ regex: "it's not \\w+", label: 'negation frame' }]
                  }
                },
                {
                  id: 'c',
                  vale: [],
                  style: { name: 'Intensifiers', message: "Empty: '%s'.", level: 'suggestion', terms: [{ term: 'very' }] }
                }
              ]
            }
          ]
        });
      });

      it('should put hintless words and phrases in the block\'s own rule and leave out a term a bundled rule checks', () => {
        expect(files['Buzzwords.yml']).toContain('(?<![\\\\w-])flumoxide(?![\\\\w-])');
        expect(files['Buzzwords.yml']).not.toContain('quuxly');
        expect(files['Buzzwords.yml']).toContain('calzone[\\\\s\\\\u00A0-]+cannon');
      });

      it('should turn drop-in hints from any block into substitution swaps', () => {
        expect(files['Substitutions.yml']).toContain('extends: substitution');
        expect(files['Substitutions.yml']).toContain('"use"');
        expect(files['Substitutions.yml']).toContain('order[\\\\s\\\\u00A0-]+to(?![\\\\w-])": "to"');
      });

      it('should give a prose-hinted term its own rule carrying the hint under the block\'s label', () => {
        expect(files['Leverage.yml']).toContain(
          'message: "Banned buzzword: \'%s\'. Use a concrete verb: use, apply, rely on."'
        );
      });

      it('should emit patterns with curly-quote tolerance next to the block\'s terms', () => {
        expect(files['Frames.yml']).toContain("it['’]s not");
      });

      it('should carry each block\'s level', () => {
        expect(files['Intensifiers.yml']).toContain('level: suggestion');
        expect(files['Intensifiers.yml']).toContain('(?<![\\\\w-])very(?![\\\\w-])');
      });

      it('should never set nonword, so a Vale vocabulary can exempt a term', () => {
        expect(Object.values(files).filter((c) => /^nonword:/m.test(c))).toEqual([]);
      });

      it('should mark every file as generated', () => {
        const headers = Object.values(files).map((c) => c.startsWith('# Generated from rules/manifest.json'));
        expect(headers).toEqual(Object.values(files).map(() => true));
      });
    });

    describe('when no term carries a drop-in hint', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({
          sections: [{ rules: [{ style: { name: 'Words', message: 'x: %s', level: 'error', terms: [{ term: 'robust' }] } }] }]
        });
      });

      it('should emit no Substitutions file', () => {
        expect(Object.keys(files)).toEqual(['Words.yml']);
      });
    });

    describe('when a hinted term spans multiple words', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({
          sections: [
            {
              rules: [
                {
                  style: {
                    name: 'Words',
                    message: 'Banned: %s',
                    level: 'error',
                    terms: [{ term: 'calzone cannon', hint: 'aim it elsewhere' }]
                  }
                }
              ]
            }
          ]
        });
      });

      it('should camel-case the rule filename from the term', () => {
        expect(Object.keys(files).sort()).toEqual(['CalzoneCannon.yml', 'Words.yml']);
      });
    });
  });

  describe('when the committed style is compared to the generator output', () => {
    let expected, committed;

    beforeEach(() => {
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'manifest.json'), 'utf8'));
      expected = buildStyleFiles(manifest);
      const dir = path.join(ROOT, 'styles', 'JustSaySo');
      committed = Object.fromEntries(
        fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')])
      );
    });

    it('should match file for file — run npm run build after editing rules/manifest.json', () => {
      expect(committed).toEqual(expected);
    });
  });
});
