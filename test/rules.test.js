import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRules, loadBanned } from '../src/lib/rules.js';
import { DEFAULTS, merge } from '../src/lib/config.js';
import { findViolations } from '../src/lib/matcher.js';

test('shipped rules files load and start with the expected headings', () => {
  assert.match(readRules('full', DEFAULTS), /^## Communication rules\n/);
  assert.match(readRules('condensed', DEFAULTS), /^## Communication rules — reminder\n/);
});

test('rules path overrides replace the shipped text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-rules-'));
  const custom = path.join(dir, 'mine.md');
  fs.writeFileSync(custom, 'my own rules');
  const config = merge(DEFAULTS, { rules: { condensedPath: custom } });
  assert.equal(readRules('condensed', config), 'my own rules');
  assert.match(readRules('full', config), /^## Communication rules\n/);
});

test('the shipped banned list catches its own headline offenders', () => {
  const { hard, soft } = findViolations(
    "In order to streamline this, we leverage robust synergy. It's not a tool, it's a platform. Very nice.",
    loadBanned(DEFAULTS)
  );
  const terms = hard.map((v) => v.term);
  assert.deepEqual(terms, [
    'leverage',
    'robust',
    'streamline',
    'synergy',
    'in order to',
    '"it\'s not {x}, it\'s {y}" frame'
  ]);
  assert.deepEqual(
    soft.map((v) => v.term),
    ['very']
  );
});

test('disableWords removes built-ins; additions append', () => {
  const config = merge(DEFAULTS, {
    bannedCheck: {
      disableWords: ['robust', 'very'],
      additions: { words: ['ninja', { term: 'rockstar', hint: 'name the role' }], phrases: ['boil the ocean'] }
    }
  });
  const banned = loadBanned(config);
  const { hard, soft } = findViolations(
    'A robust ninja rockstar will boil the ocean very quickly.',
    banned
  );
  assert.deepEqual(hard, [
    { kind: 'word', term: 'ninja', count: 1, hint: undefined },
    { kind: 'word', term: 'rockstar', count: 1, hint: 'name the role' },
    { kind: 'phrase', term: 'boil the ocean', count: 1, hint: undefined }
  ]);
  assert.deepEqual(soft, []);
});
