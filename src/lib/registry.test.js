import { describe, it, expect, beforeEach } from 'vitest';
import { fetchRegistry, stylePackages, readShippedRegistry, shippedRegistryPath } from './registry.js';

/*
 * Branch map — src/lib/registry.js
 *   stylePackages: keeps entries tagged style, drops config and malformed
 *     entries · run over the real shipped copy
 *   fetchRegistry: live list · non-ok status, bad body, and a timeout fall
 *     back to the shipped copy with the error named · no fetch available ·
 *     JUST_SAY_SO_REGISTRY=shipped skips the fetch
 */

const LIVE = [
  { name: 'Alpha', description: 'a', homepage: 'h', url: 'https://x/Alpha.zip', tags: ['style'] },
  { name: 'Hugo', description: 'h', homepage: 'h', url: 'https://x/Hugo.zip', tags: ['config'] }
];
const ok = (body) => async () => ({ ok: true, json: async () => body });

describe('registry', () => {
  describe('stylePackages', () => {
    it('should keep style entries and drop config and malformed ones, in the shipped copy too', () => {
      expect(stylePackages([...LIVE, { name: 'Bad' }, null]).map((e) => e.name)).toEqual(['Alpha']);
      const shipped = stylePackages(readShippedRegistry());
      expect(shipped.length).toBeGreaterThanOrEqual(20);
      expect(shipped.map((e) => e.name)).toContain('ai-tells');
      expect(shipped.map((e) => e.name)).not.toContain('Hugo');
      expect(shippedRegistryPath()).toMatch(/rules\/vale-library\.json$/);
    });
  });

  describe('fetchRegistry', () => {
    let live, status, body, timeout, none, skipped;

    beforeEach(async () => {
      live = await fetchRegistry({ fetchFn: ok(LIVE) });
      status = await fetchRegistry({ fetchFn: async () => ({ ok: false, status: 503 }) });
      body = await fetchRegistry({ fetchFn: ok({ not: 'a list' }) });
      timeout = await fetchRegistry({
        timeout: 20,
        fetchFn: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
      });
      none = await fetchRegistry({ fetchFn: null });
      skipped = await fetchRegistry({ fetchFn: ok(LIVE), env: { JUST_SAY_SO_REGISTRY: 'shipped' } });
    });

    it('should return the live list, or the shipped copy with the failure named', () => {
      expect(live).toEqual({ entries: LIVE, source: 'live', error: null });
      expect({ source: status.source, error: status.error, n: status.entries.length > 20 }).toEqual({ source: 'shipped', error: expect.stringContaining('answered 503'), n: true });
      expect({ source: body.source, error: body.error }).toEqual({ source: 'shipped', error: expect.stringContaining('did not return a list') });
      expect({ source: timeout.source, error: timeout.error }).toEqual({ source: 'shipped', error: 'timed out after 20 ms' });
      expect({ source: none.source, error: none.error }).toEqual({ source: 'shipped', error: 'fetch is not available' });
      expect({ source: skipped.source, error: skipped.error }).toEqual({ source: 'shipped', error: 'JUST_SAY_SO_REGISTRY=shipped' });
    });
  });
});
