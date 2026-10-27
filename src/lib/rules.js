import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, renderRules } from './manifest.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

/**
 * The rules text ("full" | "condensed"), rendered from the manifest in
 * force. Hooks that inject into a context use contextRules (rule-state.js)
 * instead, which adjusts the condensed text to the project's Vale config.
 */
export function readRules(kind, config, cwd = process.cwd()) {
  return renderRules(loadManifest(config, cwd), kind === 'condensed' ? 'condensed' : 'full');
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
