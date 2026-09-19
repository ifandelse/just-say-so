import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob, matchesAny } from '../src/lib/glob.js';

const DEFAULT_EXCLUDE = ['**/package*.json', '**/*.lock', '**/node_modules/**', '**/*.min.*'];

test('default excludes match the paths they should', () => {
  assert.equal(matchesAny('/repo/package.json', DEFAULT_EXCLUDE), true);
  assert.equal(matchesAny('/repo/pkg/package-lock.json', DEFAULT_EXCLUDE), true);
  assert.equal(matchesAny('/repo/yarn.lock', DEFAULT_EXCLUDE), true);
  assert.equal(matchesAny('/repo/node_modules/x/index.js', DEFAULT_EXCLUDE), true);
  assert.equal(matchesAny('/repo/dist/app.min.js', DEFAULT_EXCLUDE), true);
});

test('default excludes leave normal files alone', () => {
  assert.equal(matchesAny('/repo/README.md', DEFAULT_EXCLUDE), false);
  assert.equal(matchesAny('/repo/src/index.js', DEFAULT_EXCLUDE), false);
  assert.equal(matchesAny('/repo/docs/packages.md', DEFAULT_EXCLUDE), false);
});

test('a pattern without a slash matches the basename anywhere', () => {
  assert.equal(matchesGlob('/deep/nested/notes.md', '*.md'), true);
  assert.equal(matchesGlob('/deep/nested/notes.txt', '*.md'), false);
});

test('single star does not cross directory separators', () => {
  assert.equal(matchesGlob('/a/b/c.md', '/a/*.md'), false);
  assert.equal(matchesGlob('/a/c.md', '/a/*.md'), true);
});

test('question mark matches exactly one character', () => {
  assert.equal(matchesGlob('/x/a1.md', '**/a?.md'), true);
  assert.equal(matchesGlob('/x/a12.md', '**/a?.md'), false);
});

test('a relative pattern matches against the path relative to cwd', () => {
  assert.equal(matchesGlob('/repo/docs/notes.md', 'docs/**', '/repo'), true);
  assert.equal(matchesGlob('/repo/src/notes.md', 'docs/**', '/repo'), false);
  assert.equal(matchesGlob('/elsewhere/docs/notes.md', 'docs/**', '/repo'), false);
  assert.equal(matchesGlob('/repo/docs/notes.md', 'docs/**'), false, 'no cwd, no relative match');
});
