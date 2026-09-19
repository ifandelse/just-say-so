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

function toEntry(item) {
  return typeof item === 'string' ? { term: item } : item;
}

/**
 * Load rules/banned.json, drop terms listed in bannedCheck.disableWords,
 * and append bannedCheck.additions.
 */
export function loadBanned(config) {
  const base = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'rules', 'banned.json'), 'utf8'));
  const disabled = new Set((config?.bannedCheck?.disableWords ?? []).map((s) => s.toLowerCase()));
  const additions = config?.bannedCheck?.additions ?? {};
  const keep = (entry) => !disabled.has(entry.term.toLowerCase());

  return {
    words: [...(base.words ?? []).filter(keep), ...(additions.words ?? []).map(toEntry)],
    phrases: [...(base.phrases ?? []).filter(keep), ...(additions.phrases ?? []).map(toEntry)],
    patterns: [...(base.patterns ?? []), ...(additions.patterns ?? [])],
    contextual: (base.contextual ?? []).filter(keep)
  };
}
