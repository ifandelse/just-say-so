// What the resolved Vale config says about each rule for one target: on or
// off, and at which level. The rules text the model reads is adjusted to
// match: a bullet whose Vale rules the project all turned off is dropped,
// and error-level project rules that no bullet describes are named, so
// the text in context and the linter on disk agree. Read through
// `vale ls-config`, so package-supplied sections and the user-level
// styles directory count. Every failure returns null, and the caller
// injects the text unchanged.
//
// Vale's precedence, measured on 3.24.0 across 25 configurations:
// sections apply in file order, package configs before the project's, and
// inside one section the style list applies first, then style-wide
// settings, then per-rule settings. Vale keeps two sets. The first is the
// rules its selected styles supply: every BasedOnStyles line, an empty one
// included, recomputes it from that list, and a per-rule YES adds a rule
// to it outright. The second is an exclusion set: a per-rule NO adds the
// rule, a selected style's NO adds all of the style's rules, and only a
// later YES on the rule or on the selected style removes them; a new
// style list leaves exclusions in place. Style-wide YES and NO act only on
// a selected style, and a style-wide level counts as YES. A rule runs when
// it is in the first set and not in the second. For levels, a per-rule
// level beats a style-wide level in the same section and a later section
// beats an earlier one. ls-config serializes the sections as maps, which
// lose file order, so the order is read from the config files themselves.
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

function lsConfig(configPath, env) {
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
  const sections = [
    { list: resolved.GBaseStyles ?? [], checks: resolved.GChecks ?? {}, levels: resolved.RuleToLevel ?? {} },
    ...matching.map((g) => ({
      list: resolved.SBaseStyles?.[g],
      checks: resolved.SChecks?.[g] ?? {},
      levels: resolved.SLevels?.[g] ?? {}
    }))
  ];

  const ids = [...inventory.keys()];
  const styleOf = (id) => id.split('.')[0];
  const rulesOf = (style) => ids.filter((id) => styleOf(id) === style);
  let selected = new Set();
  let supplied = new Set();
  const excluded = new Set();
  const levels = new Map(inventory);

  for (const section of sections) {
    if (Array.isArray(section.list)) {
      selected = new Set(section.list);
      supplied = new Set(ids.filter((id) => selected.has(styleOf(id))));
    }
    const toggles = Object.entries(section.checks).filter(([, v]) => typeof v === 'boolean');
    for (const [style, on] of toggles.filter(([k]) => !k.includes('.'))) {
      if (!selected.has(style)) continue;
      for (const id of rulesOf(style)) {
        if (on) {
          excluded.delete(id);
          supplied.add(id);
        } else excluded.add(id);
      }
    }
    for (const [id, on] of toggles.filter(([k]) => k.includes('.'))) {
      if (on) {
        excluded.delete(id);
        supplied.add(id);
      } else excluded.add(id);
    }
    for (const [key, level] of Object.entries(section.levels)) {
      if (key.includes('.')) continue;
      for (const id of rulesOf(key)) levels.set(id, level);
    }
    for (const [key, level] of Object.entries(section.levels)) {
      if (key.includes('.')) levels.set(key, level);
    }
  }

  const state = new Map();
  for (const id of ids) {
    state.set(id, { enabled: supplied.has(id) && !excluded.has(id), level: levels.get(id) });
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
