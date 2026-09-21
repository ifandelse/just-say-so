import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRules, loadBanned, loadMessages, fill } from './rules.js';
import { DEFAULTS, merge } from './config.js';
import { findViolations } from './matcher.js';

/*
 * Branch map — src/lib/rules.js
 *   expandHome: leading "~" → home join · other → verbatim
 *   readRules: kind full/condensed · override present vs null
 *   loadBanned: disableWords filter (words + contextual) · additions as string vs object ·
 *               additions phrases/patterns · empty additions · allowPhrases wired to allow
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

    describe('when a condensed override path is configured', () => {
      let condensed, full;

      beforeEach(() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rules-'));
        const custom = path.join(dir, 'CAL_ZONE_RULES.md');
        fs.writeFileSync(custom, 'MY OWN RULES');
        const config = merge(DEFAULTS, { rules: { condensedPath: custom } });
        condensed = readRules('condensed', config);
        full = readRules('full', config);
      });

      it('should read the override for condensed', () => {
        expect(condensed).toBe('MY OWN RULES');
      });

      it('should keep the shipped text for full', () => {
        expect(full).toMatch(/^## Communication rules\n/);
      });
    });

    describe('when the override path starts with "~"', () => {
      let error;

      beforeEach(() => {
        const config = merge(DEFAULTS, { rules: { fullPath: '~/MISSING_JSS_RULES_8675309.md' } });
        try {
          readRules('full', config);
        } catch (e) {
          error = e;
        }
      });

      it('should expand it under the home directory before reading', () => {
        expect(error.path).toBe(path.join(os.homedir(), 'MISSING_JSS_RULES_8675309.md'));
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

  describe('loadBanned', () => {
    describe('when the config has no bannedCheck section', () => {
      let result;

      beforeEach(() => {
        result = findViolations('a robust plan', loadBanned({}));
      });

      it('should still apply the shipped list', () => {
        expect(result.hard).toEqual([{ kind: 'word', term: 'robust', count: 1, hint: undefined }]);
      });
    });

    describe('when the defaults load the shipped list', () => {
      let result;

      beforeEach(() => {
        result = findViolations(
          "In order to streamline this, we leverage robust synergy. It's not a tool, it's a platform. Very nice.",
          loadBanned(DEFAULTS)
        );
      });

      it('should catch the headline offenders in group order', () => {
        expect(result.hard.map((v) => v.term)).toEqual([
          'leverage',
          'robust',
          'streamline',
          'synergy',
          'in order to',
          '"it\'s not {x}, it\'s {y}" frame'
        ]);
      });

      it('should report the intensifier as an advisory', () => {
        expect(result.soft.map((v) => v.term)).toEqual(['very']);
      });
    });

    describe('when allowPhrases are configured', () => {
      let result;

      beforeEach(() => {
        const config = merge(DEFAULTS, { bannedCheck: { allowPhrases: ['robust regression'] } });
        result = findViolations('The robust regression converged.', loadBanned(config));
      });

      it('should neutralize matches inside the collocation', () => {
        expect(result).toEqual({ hard: [], soft: [] });
      });
    });

    describe('when built-ins are disabled and additions are configured', () => {
      let result;

      beforeEach(() => {
        const config = merge(DEFAULTS, {
          bannedCheck: {
            disableWords: ['robust', 'very'],
            additions: {
              words: ['ninja', { term: 'rockstar', hint: 'name the role' }],
              phrases: ['boil the ocean'],
              patterns: [{ regex: 'E_SOGGY_STROMBOLI', label: 'FAKE ERROR CODE' }]
            }
          }
        });
        result = findViolations(
          'A robust ninja rockstar will boil the ocean, very fast. E_SOGGY_STROMBOLI!',
          loadBanned(config)
        );
      });

      it('should skip disabled built-ins and match every addition', () => {
        expect(result).toEqual({
          hard: [
            { kind: 'word', term: 'ninja', count: 1, hint: undefined },
            { kind: 'word', term: 'rockstar', count: 1, hint: 'name the role' },
            { kind: 'phrase', term: 'boil the ocean', count: 1, hint: undefined },
            { kind: 'pattern', term: 'FAKE ERROR CODE', count: 1 }
          ],
          soft: []
        });
      });
    });
  });
});
