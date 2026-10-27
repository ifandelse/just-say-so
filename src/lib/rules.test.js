import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRules, loadMessages, fill } from './rules.js';
import { DEFAULTS, merge } from './config.js';

/*
 * Branch map — src/lib/rules.js
 *   expandHome: leading "~" → home join · other → verbatim
 *   readRules: kind full/condensed · override present vs null
 *   loadMessages: no override → shipped · override merges per key · unreadable override → shipped
 *   fill: known placeholder replaced · unknown placeholder left literal
 */

describe('rules', () => {
  describe('readRules', () => {
    describe('when no overrides are configured', () => {
      let full, condensed;

      beforeEach(() => {
        full = readRules('full', DEFAULTS);
        condensed = readRules('condensed', DEFAULTS);
      });

      it('should load the shipped full rules', () => {
        expect(full).toMatch(/^## Communication rules\n/);
      });

      it('should load the shipped condensed rules', () => {
        expect(condensed).toMatch(/^## Communication rules — reminder\n/);
      });
    });

    describe('when rules.manifest names another manifest', () => {
      let condensed, full;

      beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rules-'));
        const custom = path.join(dir, 'CAL_ZONE.json');
        fs.writeFileSync(
          custom,
          JSON.stringify({
            title: 'Calzone rules',
            intro: 'Fold it.',
            condensed: ['one'],
            sections: [{ title: 'Only', rules: [{ id: 'one', full: 'One idea.', short: 'One.', vale: [] }] }]
          })
        );
        const config = merge(DEFAULTS, { rules: { manifest: custom } });
        condensed = readRules('condensed', config);
        full = readRules('full', config);
      });

      it('should render both kinds from it', () => {
        expect({ condensed, full }).toEqual({
          condensed: '## Calzone rules — reminder\n\nFold it.\n\n- One.\n',
          full: '## Calzone rules\n\nFold it.\n\n### Only\n\n- One idea.\n'
        });
      });
    });
  });

  describe('fill', () => {
    describe('when a template has known and unknown placeholders', () => {
      let result;

      beforeEach(() => {
        result = fill('banned terms in {target} ({nope})', { target: 'notes.md' });
      });

      it('should replace known keys and leave unknown ones literal', () => {
        expect(result).toBe('banned terms in notes.md ({nope})');
      });
    });
  });

  describe('loadMessages', () => {
    describe('when no override is configured', () => {
      let result;

      beforeEach(() => {
        result = loadMessages(DEFAULTS);
      });

      it('should return the shipped catalog', () => {
        expect(result.bannedIntro).toBe('just-say-so: banned terms in {target}:');
        expect(result.outputRewrite).toBe('Rewrite the reply per the communication rules.');
      });
    });

    describe('when a partial override is configured', () => {
      let result;

      beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-messages-'));
        const file = path.join(dir, 'CAL_ZONE_VOICE.json');
        fs.writeFileSync(file, JSON.stringify({ bannedIntro: 'palabras prohibidas en {target}:' }));
        result = loadMessages(merge(DEFAULTS, { rules: { messagesPath: file } }));
      });

      it('should merge the override per key and keep shipped defaults for the rest', () => {
        expect(result.bannedIntro).toBe('palabras prohibidas en {target}:');
        expect(result.rewriteInstruction).toBe(
          'Rewrite the flagged text per the communication rules, then retry the tool call.'
        );
      });
    });

    describe('when the override file is unreadable', () => {
      let result;

      beforeEach(() => {
        result = loadMessages(merge(DEFAULTS, { rules: { messagesPath: '/nope/MISSING.json' } }));
      });

      it('should fall back to the shipped catalog', () => {
        expect(result.bannedIntro).toBe('just-say-so: banned terms in {target}:');
      });
    });
  });

});
