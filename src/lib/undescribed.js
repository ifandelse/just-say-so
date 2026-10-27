// The Vale rules the reminder can only name: enabled for the reply target
// and absent from every bullet's `vale` list. For each, the facts a writer
// needs to draft a bullet, read from the rule's own file: what it extends,
// its message, description, link, and a few of its tokens. The /draft
// skill feeds these to the model; this module never writes prose.
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { loadManifest } from './manifest.js';
import { lsConfig, sectionOrder, ruleStateFor, undescribedIds } from './rule-state.js';
import { listStyleRules, listStyleFiles } from './style-inventory.js';
import { REPLY_NAME, resolveValeConfig } from './vale.js';

const SAMPLE = 5;

function scalar(yaml, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(yaml);
  if (!m) return null;
  return m[1].replace(/^(['"])(.*)\1$/, '$2');
}

// The first few entries of a `tokens:` list, or the first few keys of a
// `swap:` map, so a reader sees what the rule looks for.
function sample(yaml) {
  const out = [];
  const list = /^tokens:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(yaml);
  if (list) {
    for (const line of list[1].split('\n')) {
      const m = /^[ \t]+-[ \t]*(.+?)[ \t]*$/.exec(line);
      if (m) out.push(m[1].replace(/^(['"])(.*)\1$/, '$2'));
      if (out.length === SAMPLE) break;
    }
    return out;
  }
  const map = /^swap:\s*\n((?:[ \t]+[^\n]*\n?)+)/m.exec(yaml);
  if (map) {
    for (const line of map[1].split('\n')) {
      const m = /^[ \t]+(['"]?)(.+?)\1[ \t]*:/.exec(line);
      if (m) out.push(m[2]);
      if (out.length === SAMPLE) break;
    }
  }
  return out;
}

export function describeRule(id, file, level) {
  let yaml = '';
  try {
    yaml = fs.readFileSync(file, 'utf8');
  } catch {
    // an unreadable rule file still gets its id and level
  }
  return {
    id,
    level,
    extends: scalar(yaml, 'extends'),
    message: scalar(yaml, 'message'),
    description: scalar(yaml, 'description'),
    link: scalar(yaml, 'link'),
    sample: sample(yaml)
  };
}

/**
 * The undescribed rules for the reply target under the config in force
 * at cwd, with their facts. `minLevel` is "error" by default; "suggestion"
 * includes everything enabled. Returns null when vale cannot read the
 * config.
 */
export function undescribedRules(cwd, env = process.env, { minLevel = 'error' } = {}) {
  const config = loadConfig(cwd, env);
  const resolved = lsConfig(resolveValeConfig(cwd, config), env);
  if (!resolved) return null;
  const inventory = listStyleRules(resolved.Paths ?? []);
  const files = listStyleFiles(resolved.Paths ?? []);
  const state = ruleStateFor(REPLY_NAME, resolved, inventory, sectionOrder(resolved));
  return undescribedIds(state, loadManifest(config, cwd), minLevel).map((id) =>
    describeRule(id, files.get(id), state.get(id).level)
  );
}

export function formatUndescribed(rules, { minLevel = 'error' } = {}) {
  if (rules === null) return 'just-say-so: vale could not read the config here; run /just-say-so:doctor.\n';
  if (rules.length === 0) {
    return `just-say-so: every enabled rule at ${minLevel} level or above already has a bullet. Nothing to draft.\n`;
  }
  const lines = [`${rules.length} enabled rule(s) at ${minLevel} level or above that no bullet describes:`, ''];
  for (const r of rules) {
    lines.push(`${r.id}  [${r.level}${r.extends ? `, ${r.extends}` : ''}]`);
    if (r.message) lines.push(`  message: ${r.message}`);
    if (r.description) lines.push(`  description: ${r.description}`);
    if (r.link) lines.push(`  link: ${r.link}`);
    if (r.sample.length) lines.push(`  looks for: ${r.sample.join(' · ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
