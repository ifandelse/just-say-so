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
    describe('when the banned set has every entry kind', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({
          words: [
            { term: 'flumoxide' },
            { term: 'utilize', hint: 'use "use"' },
            { term: 'leverage', hint: 'use a concrete verb: use, apply, rely on' }
          ],
          phrases: [{ term: 'calzone cannon' }, { term: 'in order to', hint: 'use "to"' }],
          patterns: [{ regex: "it's not \\w+", label: 'negation frame' }],
          contextual: [{ term: 'very' }]
        });
      });

      it('should put hintless words in Buzzwords and hintless phrases in FillerFrames', () => {
        expect(files['Buzzwords.yml']).toContain('(?<![\\\\w-])flumoxide(?![\\\\w-])');
        expect(files['FillerFrames.yml']).toContain('calzone[\\\\s\\\\u00A0-]+cannon');
      });

      it('should turn drop-in hints into substitution swaps', () => {
        expect(files['Substitutions.yml']).toContain('extends: substitution');
        expect(files['Substitutions.yml']).toContain('"use"');
        expect(files['Substitutions.yml']).toContain('in[\\\\s\\\\u00A0-]+order[\\\\s\\\\u00A0-]+to');
      });

      it('should give a prose-hinted term its own rule carrying the hint', () => {
        expect(files['Leverage.yml']).toContain(
          'message: "Banned buzzword: \'%s\'. Use a concrete verb: use, apply, rely on."'
        );
      });

      it('should emit the pattern rule with curly-quote tolerance', () => {
        expect(files['NegativeParallelism.yml']).toContain("it['’]s not");
      });

      it('should emit contextual terms at suggestion level', () => {
        expect(files['Intensifiers.yml']).toContain('level: suggestion');
        expect(files['Intensifiers.yml']).toContain('(?<![\\\\w-])very(?![\\\\w-])');
      });

      it('should never set nonword, so a Vale vocabulary can exempt a term', () => {
        expect(Object.values(files).filter((c) => /^nonword:/m.test(c))).toEqual([]);
      });

      it('should mark every file as generated', () => {
        const headers = Object.values(files).map((c) => c.startsWith('# Generated from rules/banned.json'));
        expect(headers).toEqual(Object.values(files).map(() => true));
      });
    });

    describe('when no entry carries a drop-in hint', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({ words: [{ term: 'flumoxide' }], phrases: [], patterns: [], contextual: [] });
      });

      it('should emit no Substitutions file', () => {
        expect(files['Substitutions.yml']).toBeUndefined();
      });
    });

    describe('when a hinted term spans multiple words', () => {
      let files;

      beforeEach(() => {
        files = buildStyleFiles({
          words: [{ term: 'blast radius', hint: 'name the concrete scope' }],
          phrases: [],
          patterns: [],
          contextual: []
        });
      });

      it('should camel-case the rule filename from the term', () => {
        expect(Object.keys(files)).toContain('BlastRadius.yml');
      });
    });
  });

  describe('when the committed style is compared to the generator output', () => {
    let committed, generated;

    beforeEach(() => {
      const banned = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules', 'banned.json'), 'utf8'));
      generated = buildStyleFiles(banned);
      const dir = path.join(ROOT, 'styles', 'JustSaySo');
      committed = Object.fromEntries(
        fs.readdirSync(dir).map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')])
      );
    });

    it('should match file for file — run scripts/build-style.js after editing banned.json', () => {
      expect(committed).toEqual(generated);
    });
  });
});
