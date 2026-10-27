// The Vale package registry: the list Vale resolves a bare Packages name
// from, kept at github.com/vale-cli/packages as library.json. Each entry
// has a name, a one-line description, a homepage, the release URL of its
// archive, and a tags list; "style" marks a set of writing rules and
// "config" marks markup support with no rules, which the advice skips.
// The live file is fetched with a short timeout and the copy shipped at
// rules/vale-library.json stands in when the fetch fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REGISTRY_URL = 'https://raw.githubusercontent.com/vale-cli/packages/master/library.json';
export const TOPIC_URL = 'https://github.com/topics/vale-linter-style';
const TIMEOUT_MS = 3000;

export function shippedRegistryPath() {
  return path.join(PKG_ROOT, 'rules', 'vale-library.json');
}

/** The entries that carry writing rules, in registry order. */
export function stylePackages(entries) {
  return (entries ?? []).filter((e) => e && typeof e.name === 'string' && typeof e.url === 'string' && Array.isArray(e.tags) && e.tags.includes('style'));
}

export function readShippedRegistry() {
  return JSON.parse(fs.readFileSync(shippedRegistryPath(), 'utf8'));
}

/**
 * The live registry, or the shipped copy when the fetch fails or times
 * out. Returns { entries, source: "live" | "shipped", error }.
 */
export async function fetchRegistry({ fetchFn = globalThis.fetch, timeout = TIMEOUT_MS, url = REGISTRY_URL, env = process.env } = {}) {
  let error = null;
  // JUST_SAY_SO_REGISTRY=shipped skips the network: tests, and a user who
  // wants no fetch at all.
  if (env.JUST_SAY_SO_REGISTRY === 'shipped') return { entries: readShippedRegistry(), source: 'shipped', error: 'JUST_SAY_SO_REGISTRY=shipped' };
  if (typeof fetchFn === 'function') {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const entries = await res.json();
      if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${url} did not return a list`);
      return { entries, source: 'live', error: null };
    } catch (e) {
      error = e?.name === 'TimeoutError' ? `timed out after ${timeout} ms` : String(e?.message ?? e);
    }
  } else {
    error = 'fetch is not available';
  }
  return { entries: readShippedRegistry(), source: 'shipped', error };
}
