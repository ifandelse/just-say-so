import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeZip } from './zip.js';
import { ruleIdOf, rulesFromArchive, readCache, cacheStatus, refreshPackages, prunePackages, formatCacheStatus } from './package-cache.js';

/*
 * Branch map — src/lib/package-cache.js
 *   ruleIdOf: bare style layout · complete package layout · config and
 *     non-yml entries → null
 *   rulesFromArchive: rules sorted with facts · a yml without extends is
 *     not a rule · an unreadable message is counted · a rule shipped twice
 *     (Journals/ and journals/) yields once
 *   refreshPackages: writes one file per style package, skips config
 *     entries · a failed download keeps the old file and is reported ·
 *     an unknown name is reported · named subset
 *   readCache: skips a half-written file
 *   cacheStatus: packages, missing, stale, dates, age · empty
 *   prunePackages: removes unlisted · formatCacheStatus: empty and full
 */

const REGISTRY = [
  { name: 'Alpha', description: 'a', homepage: 'h', url: 'https://x/Alpha.zip', tags: ['style'] },
  { name: 'Beta', description: 'b', homepage: 'h', url: 'https://x/Beta.zip', tags: ['style'] },
  { name: 'Hugo', description: 'h', homepage: 'h', url: 'https://x/Hugo.zip', tags: ['config'] }
];
const ALPHA = writeZip({
  'Alpha/meta.json': '{}',
  'Alpha/Loud.yml': 'extends: existence\nmessage: "Loud: %s"\nlevel: error\ntokens:\n  - zzz\n',
  'Alpha/Folded.yml': 'extends: existence\nmessage: >\n  folded text\nlevel: warning\n',
  'Alpha/config/vocabularies/X/accept.txt': 'word\n',
  'Alpha/notes.yml': 'just: notes\n'
});
const BETA = writeZip({
  'Beta/.vale.ini': 'MinAlertLevel = suggestion\n',
  'Beta/styles/Beta/Soft.yml': "extends: substitution\nmessage: 'Use %s'\nswap:\n  utilize: use\n",
  'beta/styles/Beta/Soft.yml': "extends: substitution\nmessage: 'Use %s again'\n"
});
const fetchFor = (bodies) => async (url) => {
  const body = bodies[url];
  if (body === undefined) return { ok: false, status: 404 };
  if (body instanceof Error) throw body;
  return { ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};

describe('package cache', () => {
  describe('ruleIdOf and rulesFromArchive', () => {
    it('should name rules by layout and extract their facts', () => {
      expect([ruleIdOf('Alpha/Loud.yml'), ruleIdOf('Beta/styles/Beta/sub/Soft.yml'), ruleIdOf('Alpha/config/v.yml'), ruleIdOf('Alpha/README.md'), ruleIdOf('x.yml')]).toEqual([
        'Alpha.Loud', 'Beta.sub.Soft', null, null, null
      ]);
      expect(rulesFromArchive(ALPHA)).toEqual({
        rules: [
          { id: 'Alpha.Folded', level: 'warning', extends: 'existence', message: null, description: null, link: null, sample: [] },
          { id: 'Alpha.Loud', level: 'error', extends: 'existence', message: 'Loud: %s', description: null, link: null, sample: ['zzz'] }
        ],
        unreadable: 1
      });
    });
  });

  describe('refreshing, reading, and pruning', () => {
    let env, first, second, before, status, text, pruned, after;

    beforeEach(async () => {
      env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cache-')) };
      const t1 = new Date('2026-10-01T00:00:00Z');
      first = await refreshPackages(REGISTRY, [], { env, now: t1, fetchFn: fetchFor({ 'https://x/Alpha.zip': ALPHA, 'https://x/Beta.zip': BETA }) });
      // Alpha fails the second time; Beta is not asked for; Gamma is unknown.
      second = await refreshPackages(REGISTRY, ['Alpha', 'Gamma'], { env, now: new Date('2026-10-02T00:00:00Z'), fetchFn: fetchFor({}) });
      fs.writeFileSync(path.join(env.JUST_SAY_SO_STATE_DIR, 'packages', 'Old.json'), JSON.stringify({ name: 'Old', url: 'u', fetched: '2026-09-01T00:00:00Z', rules: [] }));
      fs.writeFileSync(path.join(env.JUST_SAY_SO_STATE_DIR, 'packages', 'Half.json'), '{"name": "Half", "rul');
      before = readCache(env).map((p) => [p.name, p.fetched, p.rules.length]);
      status = cacheStatus(REGISTRY, env, new Date('2026-11-05T00:00:00Z'));
      text = formatCacheStatus(status, { source: 'live' });
      pruned = prunePackages(REGISTRY, env);
      after = readCache(env).map((p) => p.name);
    });

    it('should write one file per style package and keep the old file when a download fails', () => {
      expect(first).toEqual({ refreshed: [{ name: 'Alpha', rules: 2, unreadable: 1 }, { name: 'Beta', rules: 1, unreadable: 0 }], failed: [] });
      expect(second).toEqual({ refreshed: [], failed: [{ name: 'Gamma', error: 'not a style package in the registry' }, { name: 'Alpha', error: 'https://x/Alpha.zip answered 404' }] });
      expect(before).toEqual([
        ['Alpha', '2026-10-01T00:00:00.000Z', 2],
        ['Beta', '2026-10-01T00:00:00.000Z', 1],
        ['Old', '2026-09-01T00:00:00Z', 0]
      ]);
    });

    it('should report the cache against the registry, then prune what the registry dropped', () => {
      expect(status).toEqual({
        dir: path.join(env.JUST_SAY_SO_STATE_DIR, 'packages'),
        packages: [
          { name: 'Alpha', fetched: '2026-10-01T00:00:00.000Z', rules: 2, unreadable: 1, listed: true },
          { name: 'Beta', fetched: '2026-10-01T00:00:00.000Z', rules: 1, unreadable: 0, listed: true },
          { name: 'Old', fetched: '2026-09-01T00:00:00Z', rules: 0, unreadable: 0, listed: false }
        ],
        missing: [],
        stale: ['Old'],
        oldest: '2026-09-01T00:00:00Z',
        newest: '2026-10-01T00:00:00.000Z',
        ageDays: 65,
        rules: 3
      });
      expect(text).toBe(
        [
          `just-say-so package cache: ${status.dir}`,
          '  registry: live',
          '  3 packages · 3 rules · fetched 2026-09-01T00:00:00Z to 2026-10-01T00:00:00.000Z (65 days old; a refresh is available)',
          '  Alpha: 2 rules · 2026-10-01T00:00:00.000Z · 1 messages the parser could not read',
          '  Beta: 1 rules · 2026-10-01T00:00:00.000Z',
          '  Old: 0 rules · 2026-09-01T00:00:00Z · no longer in the registry (--prune removes it)',
          ''
        ].join('\n')
      );
      expect(pruned).toEqual(['Old']);
      expect(after).toEqual(['Alpha', 'Beta']);
    });
  });

  describe('when the cache is empty', () => {
    it('should say so and name the refresh command', () => {
      const env = { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-cache-')) };
      const status = cacheStatus(REGISTRY, env);
      expect(status).toMatchObject({ packages: [], missing: ['Alpha', 'Beta'], stale: [], oldest: null, newest: null, ageDays: null, rules: 0 });
      expect(formatCacheStatus(status)).toBe(`just-say-so package cache: ${status.dir}\n  empty. 2 style packages in the registry are available; run /just-say-so:packages --refresh to cache their rules for advice.\n`);
    });
  });
});
