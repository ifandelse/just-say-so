// What the resolved Vale config says about each rule for one target: on or
// off, and at which level. The rules text the model reads is adjusted to
// match: a bullet whose Vale rules the project all turned off is dropped,
// and error-level project rules that no bullet describes are named, so
// the text in context and the linter on disk agree. Read through
// `vale ls-config`, so package-supplied sections and the user-level
// styles directory count. Every failure returns null, and the caller
// injects the text unchanged.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { globToRegExp } from './glob.js';
import { listStyleRules } from './style-inventory.js';
import { loadManifest, renderRules, allRules } from './manifest.js';
import { loadMessages, fill } from './rules.js';
import { REPLY_NAME, resolveValeConfig } from './vale.js';

const SPAWN_TIMEOUT_MS = 10_000;
const NAMED_RULES_CAP = 12;

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

// Vale keeps [*] settings in the global fields and every other section
// under its glob. A section's BasedOnStyles replaces the global list; its
// per-rule settings and levels add to the global ones.
function sectionsMatching(name, resolved) {
  const globs = new Set([
    ...Object.keys(resolved.SBaseStyles ?? {}),
    ...Object.keys(resolved.SChecks ?? {}),
    ...Object.keys(resolved.SLevels ?? {})
  ]);
  return [...globs].filter((g) => globToRegExp(g).test(name));
}

/**
 * Per-rule state for a lint target name under a resolved config:
 * Map "Style.Rule" → { enabled, level }. `inventory` is the style
 * inventory (listStyleRules) the levels come from.
 */
export function ruleStateFor(name, resolved, inventory) {
  const matching = sectionsMatching(name, resolved);
  let styles = resolved.GBaseStyles ?? [];
  for (const g of matching) {
    const list = resolved.SBaseStyles?.[g];
    if (Array.isArray(list) && list.length > 0) styles = list;
  }
  const styleSet = new Set(styles);
  const checks = { ...(resolved.GChecks ?? {}) };
  const levels = { ...(resolved.RuleToLevel ?? {}) };
  for (const g of matching) {
    Object.assign(checks, resolved.SChecks?.[g] ?? {});
    Object.assign(levels, resolved.SLevels?.[g] ?? {});
  }

  const state = new Map();
  for (const [id, declared] of inventory) {
    const style = id.split('.')[0];
    let enabled = styleSet.has(style);
    if (checks[style] === false) enabled = false;
    if (checks[id] === true) enabled = true;
    if (checks[id] === false) enabled = false;
    state.set(id, { enabled, level: levels[id] ?? declared });
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
  const state = ruleStateFor(REPLY_NAME, resolved, inventory);

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
