// The advice inputs: for each project the summary reports on, the
// situations its recurring tags landed in, the effective reply-target
// state of every rule those situations name, a shortlist of rules per tag
// from the styles the project has installed and from the package cache,
// the project's Vale packages and reply-section styles, and the registry
// packages it does not have. The model writes the advice from these and
// names nothing they do not print. Nothing here downloads an archive.
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { resolveValeConfig, REPLY_NAME } from './vale.js';
import { lsConfig, sectionOrder, ruleStateFor } from './rule-state.js';
import { listStyleRules, listStyleFiles } from './style-inventory.js';
import { describeRule } from './undescribed.js';
import { packagesOf } from './vale-ini.js';
import { stylePackages, TOPIC_URL } from './registry.js';
import { cacheStatus, STALE_DAYS } from './package-cache.js';
import { shortlist } from './shortlist.js';
import { formatSituation, SITUATION_MIN } from './summary.js';
import { valeGlobToRegExp } from './glob.js';

// The styles selected for a lint name: [*] first, then each matching
// section in file order, where a BasedOnStyles list replaces the one
// before it. The same reading ruleStateFor makes of the config.
export function selectedStyles(name, resolved, order) {
  let list = resolved.GBaseStyles ?? [];
  for (const g of order ?? []) {
    if (!valeGlobToRegExp(g).test(name)) continue;
    const own = resolved.SBaseStyles?.[g];
    if (Array.isArray(own)) list = own;
  }
  return [...list];
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The facts of one project's Vale setup for the reply target, or vale: false. */
export function projectFacts(project, env = process.env) {
  const config = loadConfig(project, env);
  const configPath = resolveValeConfig(project, config);
  const resolved = lsConfig(configPath, env);
  if (!resolved) return { project, vale: false, configPath, packages: [], styles: [], installed: [], state: new Map() };
  const inventory = listStyleRules(resolved.Paths ?? []);
  const files = listStyleFiles(resolved.Paths ?? []);
  const order = sectionOrder(resolved);
  const state = ruleStateFor(REPLY_NAME, resolved, inventory, order);
  const installed = [...inventory.keys()].sort().map((id) => {
    const st = state.get(id);
    return { ...describeRule(id, files.get(id), st?.level ?? inventory.get(id)), enabled: Boolean(st?.enabled), installed: true, package: id.split('.')[0] };
  });
  return {
    project,
    vale: true,
    configPath,
    packages: packagesOf(readText(configPath)),
    styles: selectedStyles(REPLY_NAME, resolved, order),
    installed,
    state
  };
}

function packageNameOf(entry) {
  return entry.name;
}

/**
 * Advice inputs for a summary report. `facts(project)` supplies the
 * project facts (projectFacts by default; tests pass their own), `cache`
 * is the read package cache, `registry` the registry entries.
 */
export function adviceInputs(report, { registry = [], cache = [], env = process.env, facts = (p) => projectFacts(p, env), now = new Date() } = {}) {
  const styles = stylePackages(registry);
  const status = cacheStatus(registry, env, now);
  const projects = [...new Set(report.situations.map((s) => s.project))].filter((p) => p !== '(none)').sort();
  const out = [];
  for (const project of projects) {
    const f = facts(project);
    const situations = report.situations.filter((s) => s.project === project);
    const installedIds = new Set(f.installed.map((r) => r.id));
    const installedStyles = new Set(f.installed.map((r) => r.package));
    // Cached rules join the pool only for packages the project has not
    // installed; an installed rule is listed once, from disk.
    const pool = [...f.installed];
    for (const pkg of cache) {
      for (const rule of pkg.rules) {
        if (installedIds.has(rule.id)) continue;
        pool.push({ ...rule, enabled: false, installed: false, package: pkg.name });
      }
    }
    const perTag = situations
      .filter((s) => s.tag)
      .map((s) => ({
        tag: s.tag,
        kind: s.kind,
        named: s.rules.map((id) => {
          const st = f.state.get(id);
          return { id, installed: installedIds.has(id), enabled: Boolean(st?.enabled), level: st?.level ?? null };
        }),
        candidates: shortlist(s.tag, s.reasons, pool).map((h) => ({
          id: h.id,
          package: h.package,
          installed: h.installed,
          enabled: h.enabled,
          level: h.level ?? null,
          message: h.message,
          score: h.score,
          matched: h.matched
        }))
      }));
    const listed = new Set(f.packages.map((p) => p.toLowerCase()));
    const notInstalled = styles
      .filter((e) => !installedStyles.has(e.name) && !listed.has(e.name.toLowerCase()) && !f.packages.some((p) => p.toLowerCase().includes(`/${e.name.toLowerCase()}.zip`)))
      .map((e) => ({ name: packageNameOf(e), description: e.description ?? '', homepage: e.homepage ?? null, cached: status.packages.some((p) => p.name === e.name) }));
    out.push({
      project,
      vale: f.vale,
      configPath: f.configPath,
      packages: f.packages,
      replyStyles: f.styles,
      situations,
      tags: perTag,
      notInstalled
    });
  }
  return {
    threshold: SITUATION_MIN,
    cache: { dir: status.dir, packages: status.packages.length, rules: status.rules, oldest: status.oldest, newest: status.newest, ageDays: status.ageDays, missing: status.missing.length, available: styles.length },
    topic: TOPIC_URL,
    projects: out
  };
}

function cacheLine(c) {
  if (c.packages === 0) {
    return `package cache: empty. The registry lists ${c.available} style packages; suggestions for packages you do not have come from their one-line descriptions only. Run /just-say-so:packages --refresh to match against their rules.`;
  }
  const age = c.ageDays !== null && c.ageDays >= STALE_DAYS ? ` The oldest is ${c.ageDays} days old; /just-say-so:packages --refresh updates it.` : '';
  return `package cache: ${c.packages} packages, ${c.rules} rules, fetched ${c.oldest === c.newest ? c.oldest : `${c.oldest} to ${c.newest}`}.${c.missing ? ` ${c.missing} registry packages are not cached.` : ''}${age}`;
}

export function formatAdvice(inputs) {
  const L = ['just-say-so advice inputs', `  ${cacheLine(inputs.cache)}`];
  if (inputs.projects.length === 0) {
    L.push('', `No tag reached ${inputs.threshold} rejections in one project, and no untagged clean rejections. Nothing to advise on yet; keep tagging with /just-say-so:restate #tag.`);
    return L.join('\n') + '\n';
  }
  for (const p of inputs.projects) {
    L.push('', `Project ${p.project}`);
    if (!p.vale) L.push(`  vale could not read ${p.configPath}; rule states and installed rules are unknown here. Run /just-say-so:doctor there.`);
    else {
      L.push(`  vale config ${p.configPath} · packages: ${p.packages.length ? p.packages.join(', ') : 'none'} · reply BasedOnStyles: ${p.replyStyles.length ? p.replyStyles.join(', ') : 'none'}`);
    }
    L.push('  Situations');
    for (const s of p.situations) L.push(`    ${formatSituation(s)}`);
    for (const t of p.tags) {
      if (t.named.length) {
        L.push(`  #${t.tag} · rules the bullet names, as the reply target sees them: ${t.named.map((n) => `${n.id} (${!n.installed ? 'not installed' : n.enabled ? `on, ${n.level}` : `off, ${n.level}`})`).join('; ')}`);
      }
      if (t.candidates.length === 0) L.push(`  #${t.tag} · candidates: none found by word overlap with the tag and its reasons. That is this search's limit, not proof that no rule exists.`);
      else {
        L.push(`  #${t.tag} · candidates by word overlap (score, matched words):`);
        for (const c of t.candidates) {
          const where = c.installed ? `installed, ${c.enabled ? 'on' : 'off'}, ${c.level}` : `cached from ${c.package}, not installed`;
          L.push(`    ${c.id} [${where}] ${c.score} (${c.matched.join(', ')}) · ${c.message ?? '(no message)'}`);
        }
      }
    }
    if (p.notInstalled.length) {
      L.push(`  Registry packages this project does not have (${p.notInstalled.filter((e) => e.cached).length} of ${p.notInstalled.length} cached):`);
      for (const e of p.notInstalled) L.push(`    ${e.name}${e.cached ? '' : ' (not cached)'}: ${e.description}`);
    }
  }
  L.push('', `More packages outside the registry: ${inputs.topic}`);
  return L.join('\n') + '\n';
}
