import { describe, it, expect } from 'vitest';
import { tokenize, shortlist } from './shortlist.js';

/*
 * Branch map — src/lib/shortlist.js
 *   tokenize: ids split on dots, capitals, hyphens · stop words and short
 *     words dropped · plurals lose the s · deduped
 *   shortlist: tag words weigh 2, reason words 1 · floor · limit · ties by
 *     id · nothing to match → [] · matched words listed
 */

const RULES = [
  { id: 'ai-tells.FigurativeOwns', message: "AI ownership metaphor: '%s'. Say which file defines it." },
  { id: 'ai-tells.UndefinedTerm', message: 'Define the term before use.' },
  { id: 'Google.Acronyms', message: "Spell out '%s', if it's unfamiliar to the audience." },
  { id: 'JustSaySo.Buzzwords', message: 'Banned buzzword.' },
  { id: 'Std.Terms', message: 'Use the preferred term.' }
];

describe('shortlist', () => {
  it('should split ids and drop stop words', () => {
    expect(tokenize('ai-tells.FigurativeOwns')).toEqual(['tell', 'figurative', 'owns']);
    expect(tokenize('The term is not defined, define the TERM')).toEqual(['term', 'defined', 'define']);
    expect(tokenize('HTTPServer plurals terms acronyms class')).toEqual(['http', 'server', 'plural', 'term', 'acronym', 'class']);
  });

  it('should rank by weighted overlap above the floor, with the matched words', () => {
    const hits = shortlist('undefined-term', ['what is a pin? define the term', 'the acronym was unfamiliar'], RULES);
    expect(hits.map((h) => [h.id, h.score, h.matched])).toEqual([
      ['ai-tells.UndefinedTerm', 5, ['define', 'term', 'undefined']],
      ['Google.Acronyms', 2, ['acronym', 'unfamiliar']],
      ['Std.Terms', 2, ['term']]
    ]);
    expect(shortlist('undefined-term', [], RULES, { floor: 1, limit: 1 }).map((h) => h.id)).toEqual(['ai-tells.UndefinedTerm']);
    expect(shortlist('', [], RULES)).toEqual([]);
    expect(shortlist('nothing-here', ['zzz'], RULES)).toEqual([]);
  });
});
