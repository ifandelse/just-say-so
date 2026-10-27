import { describe, it, expect, beforeEach } from 'vitest';
import { readKey, insertKey, setKey, packagesOf, justSaySoTag, withPackage, packageUrl } from './vale-ini.js';

/*
 * Branch map — src/lib/vale-ini.js
 *   readKey: present · absent · empty value
 *   insertKey: before the first section · appended when no section
 *   setKey: replace in place · insert when absent
 *   packagesOf: none · one · several with spaces
 *   justSaySoTag: pinned · not pinned
 *   withPackage: replaces a pin · appends to a list · adds the key · no change
 */

describe('vale-ini', () => {
  describe('key helpers', () => {
    describe('when reading, inserting, and setting keys', () => {
      let results;

      beforeEach(() => {
        const ini = 'StylesPath = styles\nVocab =\n\n[*]\nBasedOnStyles = X\n';
        results = {
          present: readKey(ini, 'StylesPath'),
          empty: readKey(ini, 'Vocab'),
          absent: readKey(ini, 'MinAlertLevel'),
          inserted: insertKey(ini, 'MinAlertLevel', 'suggestion'),
          appended: insertKey('StylesPath = styles', 'Vocab', 'P'),
          replaced: setKey(ini, 'StylesPath', 'other'),
          added: setKey(ini, 'Packages', 'u')
        };
      });

      it('should read values and keep keys in the global block', () => {
        expect(results).toEqual({
          present: 'styles',
          empty: '',
          absent: null,
          inserted: 'StylesPath = styles\nVocab =\nMinAlertLevel = suggestion\n\n[*]\nBasedOnStyles = X\n',
          appended: 'StylesPath = styles\nVocab = P\n',
          replaced: 'StylesPath = other\nVocab =\n\n[*]\nBasedOnStyles = X\n',
          added: 'StylesPath = styles\nVocab =\nPackages = u\n\n[*]\nBasedOnStyles = X\n'
        });
      });
    });
  });

  describe('packages', () => {
    describe('when the Packages line takes every shape', () => {
      let results;

      beforeEach(() => {
        const url = packageUrl('0.11.0');
        const old = packageUrl('0.9.0');
        results = {
          url,
          none: packagesOf('StylesPath = styles\n'),
          several: packagesOf(`Packages = Microsoft , ${old},acme\n`),
          tag: justSaySoTag(`Packages = Microsoft, ${old}\n`),
          noTag: justSaySoTag('Packages = Microsoft\n'),
          replaced: withPackage(`Packages = Microsoft, ${old}\n[*]\n`, url),
          appended: withPackage('Packages = Microsoft\n', url),
          added: withPackage('StylesPath = styles\n[*]\n', url),
          same: withPackage(`Packages = ${url}\n`, url)
        };
      });

      it('should parse, pin, and leave a current pin alone', () => {
        expect(results).toEqual({
          url: 'https://github.com/ifandelse/just-say-so/releases/download/v0.11.0/JustSaySo.zip',
          none: [],
          several: ['Microsoft', packageUrl('0.9.0'), 'acme'],
          tag: 'v0.9.0',
          noTag: null,
          replaced: { text: `Packages = Microsoft, ${results.url}\n[*]\n`, changed: true },
          appended: { text: `Packages = Microsoft, ${results.url}\n`, changed: true },
          added: { text: `StylesPath = styles\nPackages = ${results.url}\n[*]\n`, changed: true },
          same: { text: `Packages = ${results.url}\n`, changed: false }
        });
      });
    });
  });
});
