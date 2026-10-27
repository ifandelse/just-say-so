// The package cache: the rule facts of every writing-rule package in the
// Vale registry, downloaded on the user's say-so into the state directory
// and reduced to one JSON file per package. The advice shortlists against
// these facts for packages the project has not installed. Nothing here
// runs on its own: the advise CLI only reads the cache, and
// /just-say-so:packages fills it.
//
// An archive is an untrusted download. It is read in memory with the zip
// reader, only .yml entries are looked at, and nothing from it is written
// to disk or run.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';
import { readZip } from './zip.js';
import { describeRuleText } from './undescribed.js';
import { stylePackages } from './registry.js';

const DOWNLOAD_TIMEOUT_MS = 30000;
export const STALE_DAYS = 30;

export function cacheDir(env = process.env) {
  return path.join(stateDir(env), 'packages');
}

function cacheFile(name, env) {
  return path.join(cacheDir(env), `${name}.json`);
}

// A Vale package archive holds either a bare style directory
// (Name/Rule.yml) or a complete package (Name/styles/Style/Rule.yml, with
// a .vale.ini beside styles). Vocabularies under config/ are not rules.
export function ruleIdOf(entryName) {
  const parts = entryName.split('/').filter(Boolean);
  if (parts.length < 2 || !parts[parts.length - 1].endsWith('.yml')) return null;
  let style;
  let rel;
  if (parts[1] === 'styles') {
    if (parts.length < 4) return null;
    style = parts[2];
    rel = parts.slice(3);
  } else {
    style = parts[0];
    rel = parts.slice(1);
  }
  if (style === 'config' || rel[0] === 'config') return null;
  return `${style}.${rel.join('.').slice(0, -4)}`;
}

/**
 * The rule facts in an archive buffer: { rules, unreadable }. An archive
 * that holds the same rule twice (Journals ships Journals/ and journals/)
 * yields it once.
 */
export function rulesFromArchive(buf) {
  const rules = [];
  const seen = new Set();
  let unreadable = 0;
  for (const entry of readZip(buf)) {
    const id = ruleIdOf(entry.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const yaml = entry.data.toString('utf8');
    if (!/^extends:/m.test(yaml)) continue;
    const facts = describeRuleText(id, yaml);
    if (facts.message === null && /^message:/m.test(yaml)) unreadable++;
    rules.push(facts);
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return { rules, unreadable };
}

/** Every cached package: [{ name, url, fetched, rules, unreadable }]. */
export function readCache(env = process.env) {
  const dir = cacheDir(env);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (pkg && typeof pkg.name === 'string' && Array.isArray(pkg.rules)) out.push(pkg);
    } catch {
      // a half-written file is skipped, and the next refresh rewrites it
    }
  }
  return out;
}

/**
 * The cache against the registry: which style packages are cached, with
 * their dates and rule counts, which are missing, and which cached names
 * the registry no longer lists.
 */
export function cacheStatus(registryEntries, env = process.env, now = new Date()) {
  const cached = readCache(env);
  const styles = stylePackages(registryEntries);
  const names = new Set(styles.map((e) => e.name));
  const byName = new Map(cached.map((p) => [p.name, p]));
  const dates = cached.map((p) => p.fetched).filter(Boolean).sort();
  const oldest = dates[0] ?? null;
  const ageDays = oldest ? Math.floor((now.getTime() - Date.parse(oldest)) / (24 * 60 * 60 * 1000)) : null;
  return {
    dir: cacheDir(env),
    packages: cached.map((p) => ({ name: p.name, fetched: p.fetched, rules: p.rules.length, unreadable: p.unreadable ?? 0, listed: names.has(p.name) })),
    missing: styles.filter((e) => !byName.has(e.name)).map((e) => e.name),
    stale: cached.filter((p) => !names.has(p.name)).map((p) => p.name),
    oldest,
    newest: dates[dates.length - 1] ?? null,
    ageDays,
    rules: cached.reduce((n, p) => n + p.rules.length, 0)
  };
}

/**
 * Download the named style packages (every one when `names` is empty)
 * and write their rule facts. A failed download leaves the package's
 * previous file alone. Returns { refreshed, failed: [{ name, error }] }.
 */
export async function refreshPackages(registryEntries, names = [], { env = process.env, fetchFn = globalThis.fetch, now = new Date(), timeout = DOWNLOAD_TIMEOUT_MS } = {}) {
  const styles = stylePackages(registryEntries);
  const wanted = names.length ? styles.filter((e) => names.includes(e.name)) : styles;
  const unknown = names.filter((n) => !styles.some((e) => e.name === n));
  const refreshed = [];
  const failed = unknown.map((name) => ({ name, error: 'not a style package in the registry' }));
  fs.mkdirSync(cacheDir(env), { recursive: true });
  for (const entry of wanted) {
    try {
      const res = await fetchFn(entry.url, { signal: AbortSignal.timeout(timeout), redirect: 'follow' });
      if (!res.ok) throw new Error(`${entry.url} answered ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const { rules, unreadable } = rulesFromArchive(buf);
      const record = { name: entry.name, url: entry.url, fetched: now.toISOString(), rules, unreadable };
      const file = cacheFile(entry.name, env);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
      fs.renameSync(`${file}.tmp`, file);
      refreshed.push({ name: entry.name, rules: rules.length, unreadable });
    } catch (e) {
      failed.push({ name: entry.name, error: e?.name === 'TimeoutError' ? `timed out after ${timeout} ms` : String(e?.message ?? e) });
    }
  }
  return { refreshed, failed };
}

/** Remove cached packages the registry no longer lists. Returns the names. */
export function prunePackages(registryEntries, env = process.env) {
  const { stale } = cacheStatus(registryEntries, env);
  for (const name of stale) fs.rmSync(cacheFile(name, env), { force: true });
  return stale;
}

export function formatCacheStatus(status, { source = null } = {}) {
  const L = [`just-say-so package cache: ${status.dir}`];
  if (source) L.push(`  registry: ${source}`);
  if (status.packages.length === 0) {
    L.push(`  empty. ${status.missing.length} style packages in the registry are available; run /just-say-so:packages --refresh to cache their rules for advice.`);
    return L.join('\n') + '\n';
  }
  L.push(`  ${status.packages.length} packages · ${status.rules} rules · fetched ${status.oldest === status.newest ? status.oldest : `${status.oldest} to ${status.newest}`}${status.ageDays !== null && status.ageDays >= STALE_DAYS ? ` (${status.ageDays} days old; a refresh is available)` : ''}`);
  for (const p of status.packages) {
    L.push(`  ${p.name}: ${p.rules} rules · ${p.fetched}${p.unreadable ? ` · ${p.unreadable} messages the parser could not read` : ''}${p.listed ? '' : ' · no longer in the registry (--prune removes it)'}`);
  }
  if (status.missing.length) L.push(`  not cached: ${status.missing.join(', ')}`);
  return L.join('\n') + '\n';
}
