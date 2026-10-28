// The doctor report: what the plugin believes the configuration means, next
// to the facts it read. One run answers "which rules does each target lint
// under, and what is wrong with the setup". The per-target reading comes
// from rule-state.js, which models Vale's config resolution; the raw
// section settings print beside it so a reader can check the model
// against the config when they disagree.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, configFiles, findLegacyKeys, publishOn } from './config.js';
import { findValeConfig, resolveValeConfig, shippedConfigPath, probeVale, REPLY_NAME } from './vale.js';
import { lsConfig, sectionOrder, ruleStateFor } from './rule-state.js';
import { listStyleRules } from './style-inventory.js';
import { valeGlobToRegExp } from './glob.js';
import { readKey, justSaySoTag, packagesOf } from './vale-ini.js';
import { loadExtra, extraFile, mergeExtra, shippedManifestPath, DEFAULT_EXTRA } from './manifest.js';
import { pluginVersion } from './version.js';
import { readCache } from './package-cache.js';

// The names the hooks lint under, one per target, plus the three file kinds
// a project writes most.
export const TARGETS = [
  ['reply', REPLY_NAME],
  ['publish', 'gh.pr.body.publish'],
  ['artifact', 'artifact.page.html'],
  ['files .md', 'doc.md'],
  ['files .html', 'page.html'],
  ['files .js', 'code.js']
];

function valeVersion(env) {
  const r = spawnSync('vale', ['--version'], { encoding: 'utf8', timeout: 10_000, env });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).trim().replace(/^vale version /, '');
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function countFileLines(file) {
  const text = readText(file);
  return text === null ? null : text.split('\n').filter((l) => l.trim()).length;
}

// Per target: how many of each style's rules are on, how many of the
// rules that are on sit at each level, and the rules of a selected style
// that are off.
function targetSummary(name, resolved, inventory, order) {
  const state = ruleStateFor(name, resolved, inventory, order);
  const perStyle = new Map();
  const levels = { error: 0, warning: 0, suggestion: 0 };
  const off = [];
  for (const [id, s] of state) {
    const style = id.split('.')[0];
    const row = perStyle.get(style) ?? { on: 0, total: 0 };
    row.total++;
    if (s.enabled) {
      row.on++;
      if (s.level in levels) levels[s.level]++;
    }
    perStyle.set(style, row);
  }
  for (const [id, s] of state) {
    const row = perStyle.get(id.split('.')[0]);
    if (!s.enabled && row.on > 0) off.push(id);
  }
  const styles = [...perStyle.entries()].filter(([, r]) => r.on > 0).map(([style, r]) => `${style} ${r.on} of ${r.total} rules on`);
  const levelText = Object.entries(levels)
    .filter(([, n]) => n > 0)
    .map(([level, n]) => `${n} ${level}`)
    .join(', ');
  const sections = ['[*]', ...order.filter((g) => valeGlobToRegExp(g).test(name)).map((g) => `[${g}]`)];
  const justSaySoOn = (perStyle.get('JustSaySo')?.on ?? 0) > 0;
  return { styles, errors: levels.error, levelText, off, sections, justSaySoOn };
}

// A brace-list section names literal paths; the ones that no longer exist
// are clutter the author should drop.
function missingSectionPaths(glob, configDir) {
  const m = /^\{(.*)\}$/.exec(glob);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p && !/[*?[\]]/.test(p) && !fs.existsSync(path.resolve(configDir, p)));
}

function rawSection(glob, resolved) {
  const parts = [];
  const list = glob === '*' ? resolved.GBaseStyles : resolved.SBaseStyles?.[glob];
  if (Array.isArray(list)) parts.push(`BasedOnStyles = ${list.join(', ')}`);
  const checks = glob === '*' ? resolved.GChecks : resolved.SChecks?.[glob];
  const levels = glob === '*' ? resolved.RuleToLevel : resolved.SLevels?.[glob];
  for (const [k, v] of Object.entries(checks ?? {})) {
    if (levels?.[k]) continue;
    parts.push(`${k} = ${v ? 'YES' : 'NO'}`);
  }
  for (const [k, v] of Object.entries(levels ?? {})) parts.push(`${k} = ${v}`);
  return parts.length > 0 ? `[${glob}] ${parts.join('; ')}` : `[${glob}] (nothing set)`;
}

/**
 * Gather every fact the report prints. Returns { facts, targets, raw,
 * warnings } with plain strings, so the CLI and the tests read the same
 * shape. Nothing here throws on a broken setup: a missing piece becomes a
 * warning.
 */
function loadManifestBase(config, cwd) {
  return JSON.parse(fs.readFileSync(path.resolve(cwd, String(config.rules.manifest).replace(/^~/, os.homedir())), 'utf8'));
}

export function doctorReport(cwd, env = process.env) {
  const config = loadConfig(cwd, env);
  const version = pluginVersion();
  const warnings = [];
  const facts = [];

  // Vale binary.
  const valeFound = probeVale(env);
  const vver = valeFound ? valeVersion(env) : null;
  facts.push(`vale: ${valeFound ? `${vver ?? 'found'} (errata-ai)` : 'missing from PATH, or not errata-ai vale'}`);
  if (!valeFound) warnings.push('vale is missing from PATH, or is a different tool named vale. Install errata-ai vale (brew install vale).');

  // Config files in force.
  const files = configFiles(cwd, env);
  facts.push(`plugin config: ${files.map((f) => `${f}${fs.existsSync(f) ? '' : ' (absent)'}`).join(' ← ')}`);
  for (const { file, keys } of findLegacyKeys(cwd, env)) {
    warnings.push(`${file} sets ${keys.join(', ')}, which 0.9.0 and later do not read. See the README section Upgrading from 0.8.x.`);
  }
  const p = config.publish;
  facts.push(
    `targets: files ${config.files.mode} (show ${config.files.show}) · publish ${p.mode}${p.gh ? ', gh' : ''}${p.mcp.length ? `, mcp ${p.mcp.length} pattern(s)` : ''}${p.artifact ? ', artifact' : ''}${publishOn(config) ? '' : ' (no source on)'} · reply ${config.reply.mode}`
  );
  facts.push(
    `rules: context start [${(config.rules.onContextStart ?? []).join(', ')}] as ${config.rules.contextStartText === 'condensed' ? 'condensed' : 'full'} text · subagents ${config.rules.onSubagentStart ? 'yes' : 'no'} · on violation ${config.rules.onViolation ? 'yes' : 'no'}`
  );
  const cache = readCache(env);
  if (cache.length === 0) facts.push('package cache: empty (/just-say-so:packages --refresh fills it, for advice on packages you do not have)');
  else {
    const dates = cache.map((c) => c.fetched).filter(Boolean).sort();
    facts.push(`package cache: ${cache.length} packages, ${cache.reduce((n, c) => n + c.rules.length, 0)} rules, fetched ${dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`}`);
  }

  // Vale config.
  const explicit = config.vale?.config ?? null;
  const discovered = explicit ? null : findValeConfig(cwd);
  const configPath = resolveValeConfig(cwd, config);
  const how = explicit ? 'vale.config' : discovered ? 'nearest above cwd' : 'shipped fallback';
  facts.push(`vale config: ${configPath} (${how})`);
  if (!explicit && !discovered) {
    warnings.push('No .vale.ini above this directory, so the shipped fallback applies here and a commit hook or CI has no config to share. Run /just-say-so:init to add one.');
  }
  const ini = readText(configPath) ?? '';
  const stylesPath = readKey(ini, 'StylesPath');
  const stylesDir = stylesPath ? path.resolve(path.dirname(configPath), stylesPath) : null;
  const tag = justSaySoTag(ini);
  const packages = packagesOf(ini);
  facts.push(`packages: ${packages.length ? packages.join(', ') : 'none'}`);
  if (tag && version && tag !== `v${version}`) {
    warnings.push(`The JustSaySo package is pinned at ${tag} and the plugin is ${version}. Update the Packages URL and run vale sync, or run /just-say-so:init.`);
  }
  if (packages.length > 0 && stylesDir && !fs.existsSync(path.join(stylesDir, '.vale-config'))) {
    warnings.push(`Packages are listed but ${stylesDir} holds no synced package config. Run vale sync.`);
  }
  if (tag && stylesDir && !fs.existsSync(path.join(stylesDir, 'JustSaySo'))) {
    warnings.push('The JustSaySo package is listed but its style is not under StylesPath. Run vale sync.');
  }
  const vocab = readKey(ini, 'Vocab');
  if (vocab && stylesDir) {
    const accept = path.join(stylesDir, 'config', 'vocabularies', vocab, 'accept.txt');
    const n = countFileLines(accept);
    facts.push(`vocabulary: ${vocab} (${n === null ? 'no accept.txt' : `${n} accepted`})`);
    if (!fs.existsSync(path.dirname(accept))) {
      warnings.push(`Vocab = ${vocab} names a vocabulary with no directory, and Vale stops with E100 on every run until it exists. Create ${path.dirname(accept)} with an empty accept.txt, or run /just-say-so:init.`);
    }
  } else {
    facts.push('vocabulary: none (/just-say-so:allow adds one)');
  }

  // Resolved config.
  const resolved = valeFound ? lsConfig(configPath, env) : null;
  const targets = [];
  const raw = [];
  if (!resolved) {
    if (valeFound) warnings.push(`vale ls-config could not read ${configPath}. Run it by hand to see the error.`);
    return { version, facts, targets, raw, warnings };
  }
  const formats = resolved.Formats ?? {};
  const mapped = formats.reply === 'md' && formats.publish === 'md';
  facts.push(`formats: reply = ${formats.reply ?? 'unset'}, publish = ${formats.publish ?? 'unset'}`);
  if (!mapped) {
    warnings.push('reply and publish are not mapped to Markdown in [formats], so chat and published text lint as plain text. Add the JustSaySo package and run vale sync, or add the [formats] lines.');
  }
  const order = sectionOrder(resolved);
  for (const g of order) {
    if (g.includes('chat.md')) warnings.push(`Section [${g}] matches nothing since 0.9.0. Rename it to [*.reply] or [*.publish].`);
    const gone = missingSectionPaths(g, path.dirname(configPath));
    if (gone.length > 0) warnings.push(`Section [${g.length > 60 ? g.slice(0, 57) + '...' : g}] names paths that do not exist: ${gone.join(', ')}. Drop them from the list.`);
  }
  const global = resolved.GBaseStyles ?? [];
  for (const [g, list] of Object.entries(resolved.SBaseStyles ?? {})) {
    if (Array.isArray(list) && list.length > 0 && list.join(',') !== global.join(',')) {
      warnings.push(`Section [${g}] restates BasedOnStyles as "${list.join(', ')}", so the [*] styles (${global.join(', ') || 'none'}) do not reach it. Restate the whole list there, or use Style = NO lines instead.`);
    }
  }
  const inventory = listStyleRules(resolved.Paths ?? []);
  const anyJustSaySo = [...inventory.keys()].some((id) => id.startsWith('JustSaySo.'));
  if (!anyJustSaySo) warnings.push('The JustSaySo style is not installed under any styles path this config reads.');

  for (const [label, name] of TARGETS) {
    const t = targetSummary(name, resolved, inventory, order);
    targets.push({
      label,
      name,
      line: `${label.padEnd(12)} ${name.padEnd(20)} ${t.styles.length ? `${t.styles.join(' · ')} · levels: ${t.levelText}` : 'no rules on'}${t.off.length ? ` · off: ${t.off.slice(0, 6).join(', ')}${t.off.length > 6 ? ` (and ${t.off.length - 6} more)` : ''}` : ''}`,
      sections: t.sections.join(' '),
      errors: t.errors,
      justSaySoOn: t.justSaySoOn
    });
  }
  raw.push(rawSection('*', resolved));
  for (const g of order) raw.push(rawSection(g, resolved));

  const extra = loadExtra(config, cwd);
  const extraWhere = extraFile(config, cwd);
  if (extraWhere && !extra) warnings.push(`${extraWhere.source === 'config' ? 'rules.extra names' : 'the extra rules file'} ${extraWhere.path}, which cannot be read as JSON, so its bullets are not in the reminder.`);
  if (extra) {
    const base = config.rules?.manifest ? loadManifestBase(config, cwd) : JSON.parse(fs.readFileSync(shippedManifestPath(), 'utf8'));
    const merged = mergeExtra(base, extra);
    facts.push(`extra rules: ${extraWhere.path} (${extraWhere.source === 'config' ? 'rules.extra' : `the default name, ${DEFAULT_EXTRA}`}) · added ${merged.added.length}, replaced ${merged.replaced.length}, dropped ${merged.dropped.length}`);
    if (merged.unknownDrops.length) warnings.push(`The extra rules file drops ${merged.unknownDrops.join(', ')}, which match no bullet id, so nothing was dropped. Check the ids against rules/manifest.json.`);
  } else facts.push(`extra rules: none (${DEFAULT_EXTRA} in the project root, or rules.extra, adds, replaces, or drops bullets)`);
  const unknown = (extra?.sections ?? [])
    .flatMap((sec) => sec.rules ?? [])
    .flatMap((r) => (r.vale ?? []).map((id) => [r.id, id]))
    .filter(([, id]) => !inventory.has(id));
  if (unknown.length > 0) {
    warnings.push(`rules.extra names Vale rules no installed style has: ${unknown.map(([b, id]) => `${id} (bullet ${b})`).join(', ')}. Fix the id or sync the style.`);
  }
  if (anyJustSaySo && targets.every((t) => !t.justSaySoOn)) {
    warnings.push('The JustSaySo style is installed but no section lists it in BasedOnStyles, so no target lints under it. Add it to BasedOnStyles in [*].');
  }

  const blockTargets = [];
  if (config.files.mode === 'block') blockTargets.push('files .md');
  if (p.mode === 'block' && (p.gh === true || p.mcp.length > 0)) blockTargets.push('publish');
  if (p.mode === 'block' && p.artifact === true) blockTargets.push('artifact');
  if (config.reply.mode === 'block') blockTargets.push('reply');
  for (const label of blockTargets) {
    const t = targets.find((x) => x.label === label);
    if (t && t.errors === 0) warnings.push(`${label} is in block mode but no error-level rule is enabled for ${t.name}, so it can never block.`);
  }

  return { version, facts, targets, raw, warnings };
}

export function formatDoctor(report) {
  const lines = [`just-say-so doctor — plugin ${report.version ?? 'unknown'}`, ''];
  lines.push('Setup');
  for (const f of report.facts) lines.push(`  ${f}`);
  if (report.targets.length > 0) {
    lines.push('', "Targets (the plugin's reading of the Vale config: rules on per style, then how many of those sit at each level)");
    for (const t of report.targets) lines.push(`  ${t.line}`, `  ${''.padEnd(12)} sections: ${t.sections}`);
    lines.push('', 'Raw section settings, in the order Vale applies them');
    for (const r of report.raw) lines.push(`  ${r}`);
  }
  lines.push('');
  if (report.warnings.length === 0) lines.push('No warnings.');
  else {
    lines.push(`Warnings (${report.warnings.length})`);
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n') + '\n';
}
