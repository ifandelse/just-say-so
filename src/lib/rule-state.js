// What the resolved Vale config says about each rule for one target: on or
// off, and at which level. The rules text the model reads is adjusted to
// match: a bullet whose Vale rules the project all turned off is dropped,
// and error-level project rules that no bullet describes are named, so
// the text in context and the linter on disk agree. Read through
// `vale ls-config`, so package-supplied sections and the user-level
// styles directory count. Every failure returns null, and the caller
// injects the text unchanged.
//
// Vale's precedence, measured on 3.24.0 across some forty configurations
// and kept as test/integration/rule-state-vale.test.js. Sections apply in
// file order, package configs before the project's. Selection is only
// BasedOnStyles: every list, an empty one included, recomputes the rules
// the selected styles supply, and drops every YES setting made before it
// while keeping every NO. Settings resolve by precedence, not by order:
// a per-rule setting in a matching section, then a style-wide setting in
// a matching section, then a per-rule setting in [*], then a style-wide
// setting in [*]; among sections the later one wins for the same key. A
// per-rule YES runs the rule outright. A style-wide YES (a level counts
// as one) runs a rule only when its style is selected or a per-rule
// setting mentions the rule somewhere. NO turns the rule off. With no
// setting, the rule runs when its style is selected. Levels resolve by
// the same precedence. ls-config serializes the sections as maps, which
// lose file order, so the order is read from the config files.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { valeGlobToRegExp } from './glob.js';
import { listStyleRules } from './style-inventory.js';
import { loadManifest, renderRules, allRules } from './manifest.js';
import { loadMessages, fill } from './rules.js';
import { REPLY_NAME, resolveValeConfig } from './vale.js';

const SPAWN_TIMEOUT_MS = 10_000;
const NAMED_RULES_CAP = 12;
const GLOBAL = '*';

export function lsConfig(configPath, env) {
  let r;
  try {
    r = spawnSync('vale', ['ls-config', `--config=${configPath}`], {
      cwd: path.dirname(path.resolve(configPath)),
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      env
    });
  } catch {
    return null;
  }
  if (!r || r.error || r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || 'null');
  } catch {
    return null;
  }
}

function sectionHeaders(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  // A header runs to its last "]", so a character class inside it stays,
  // and a trailing comment after it is ignored, the way Vale's INI reader
  // takes them.
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('[')) continue;
    const close = line.lastIndexOf(']');
    if (close === -1) continue;
    const name = line.slice(1, close).trim();
    if (name && name !== 'formats' && name !== GLOBAL) out.push(name);
  }
  return out;
}

/**
 * The section globs of a resolved config in the order Vale applies them:
 * each package config (`.vale-config/*.ini` under a styles path, in name
 * order), then the config files proper. Globs the maps hold that no file
 * yields come last, so nothing is lost when a file cannot be read.
 */
export function sectionOrder(resolved) {
  const files = [];
  for (const dir of resolved.Paths ?? []) {
    const packaged = path.join(dir, '.vale-config');
    let names = [];
    try {
      names = fs.readdirSync(packaged).filter((n) => n.endsWith('.ini')).sort();
    } catch {
      // no package configs under this path
    }
    files.push(...names.map((n) => path.join(packaged, n)));
  }
  files.push(...(resolved.ConfigFiles ?? []));

  const order = [];
  const seen = new Set();
  const push = (g) => {
    if (!seen.has(g)) {
      seen.add(g);
      order.push(g);
    }
  };
  for (const file of files) for (const g of sectionHeaders(file)) push(g);
  for (const map of [resolved.SBaseStyles, resolved.SChecks, resolved.SLevels]) {
    for (const g of Object.keys(map ?? {})) push(g);
  }
  return order;
}

/**
 * Per-rule state for a lint target name under a resolved config:
 * Map "Style.Rule" → { enabled, level }. `inventory` is the style
 * inventory (listStyleRules) the declared levels come from; `order` is
 * the section globs in file order (sectionOrder).
 */
export function ruleStateFor(name, resolved, inventory, order) {
  const matching = (order ?? []).filter((g) => valeGlobToRegExp(g).test(name));
  const ids = [...inventory.keys()];
  const styleOf = (id) => id.split('.')[0];
  const isRule = (key) => key.includes('.');

  // Each setting remembers where it was made; a section beats [*].
  const toggles = new Map(); // key → { on, scope }
  const levels = new Map(); // key → { level, scope }
  const mentioned = new Set(); // rule ids a per-rule setting names anywhere
  let supplied = new Set();

  const select = (list) => {
    const selected = new Set(list);
    supplied = new Set(ids.filter((id) => selected.has(styleOf(id))));
    for (const [key, t] of toggles) if (t.on) toggles.delete(key);
  };
  const apply = (scope, checks, lvls) => {
    for (const [key, on] of Object.entries(checks ?? {})) {
      if (typeof on !== 'boolean') continue;
      toggles.set(key, { on, scope });
      if (isRule(key)) mentioned.add(key);
    }
    for (const [key, level] of Object.entries(lvls ?? {})) levels.set(key, { level, scope });
  };

  select(resolved.GBaseStyles ?? []);
  apply('global', resolved.GChecks, resolved.RuleToLevel);
  for (const g of matching) {
    const list = resolved.SBaseStyles?.[g];
    if (Array.isArray(list)) select(list);
    apply('section', resolved.SChecks?.[g], resolved.SLevels?.[g]);
  }

  // Section per-rule, section style-wide, global per-rule, global style-wide.
  const pick = (map, id) => {
    const rule = map.get(id);
    const style = map.get(styleOf(id));
    if (rule?.scope === 'section') return { ...rule, byRule: true };
    if (style?.scope === 'section') return { ...style, byRule: false };
    if (rule) return { ...rule, byRule: true };
    if (style) return { ...style, byRule: false };
    return null;
  };

  const state = new Map();
  for (const id of ids) {
    const t = pick(toggles, id);
    let enabled;
    if (!t) enabled = supplied.has(id);
    else if (!t.on) enabled = false;
    else enabled = t.byRule || supplied.has(id) || mentioned.has(id);
    state.set(id, { enabled, level: pick(levels, id)?.level ?? inventory.get(id) });
  }
  return state;
}

/**
 * The condensed rules text for a context, adjusted to the project's Vale
 * config for the reply target. Returns the unadjusted text when vale or
 * the config cannot be read, or when the caller's probe already found
 * no vale binary (`vale: false`).
 */
export function contextRules(config, anchorDir, env = process.env, { vale = null } = {}) {
  const manifest = loadManifest(config);
  if (vale === false) return renderRules(manifest, 'condensed');
  const configPath = resolveValeConfig(anchorDir, config);
  const resolved = lsConfig(configPath, env);
  if (!resolved) return renderRules(manifest, 'condensed');

  const inventory = listStyleRules(resolved.Paths ?? []);
  const state = ruleStateFor(REPLY_NAME, resolved, inventory, sectionOrder(resolved));

  // A bullet goes when every installed Vale rule it names is turned off.
  // A rule the inventory lacks (a style the project never installed)
  // checks nothing, so it neither keeps nor drops the bullet; a bullet
  // whose rules are all uninstalled stays.
  const drop = new Set();
  const described = new Set();
  for (const rule of allRules(manifest)) {
    const ids = rule.vale ?? [];
    for (const id of ids) described.add(id);
    const installed = ids.filter((id) => state.has(id));
    if (installed.length > 0 && installed.every((id) => !state.get(id).enabled)) drop.add(rule.id);
  }

  const undescribed = [...state.entries()]
    .filter(([id, s]) => s.enabled && s.level === 'error' && !described.has(id))
    .map(([id]) => id)
    .sort();
  let append = null;
  if (undescribed.length > 0) {
    const messages = loadMessages(config);
    const shown = undescribed.slice(0, NAMED_RULES_CAP);
    const more = undescribed.length - shown.length;
    append = fill(messages.rulesAlsoEnforced, {
      rules: shown.join(', ') + (more > 0 ? ` ${fill(messages.replyReportMore, { n: more })}` : '')
    });
  }
  return renderRules(manifest, 'condensed', { drop, append });
}
