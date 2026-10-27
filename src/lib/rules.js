import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * Read the rules text ("full" | "condensed"). Config paths override the
 * shipped defaults, so the plugin carries anyone's rules, not just ours.
 */
export function readRules(kind, config) {
  const override = kind === 'condensed' ? config?.rules?.condensedPath : config?.rules?.fullPath;
  const file = override
    ? expandHome(override)
    : path.join(PKG_ROOT, 'rules', kind === 'condensed' ? 'condensed.md' : 'full.md');
  return fs.readFileSync(file, 'utf8');
}

// {key} placeholders; unknown keys stay literal so a typo is visible.
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

/**
 * Load the message catalog. A user file at rules.messagesPath overrides
 * per key; unlisted keys keep the shipped English. A missing or malformed
 * override falls back silently — hooks must never break on config.
 */
export function loadMessages(config) {
  const shipped = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'rules', 'messages.json'), 'utf8'));
  const override = config?.rules?.messagesPath;
  if (!override) return shipped;
  try {
    return { ...shipped, ...JSON.parse(fs.readFileSync(expandHome(override), 'utf8')) };
  } catch {
    return shipped;
  }
}
