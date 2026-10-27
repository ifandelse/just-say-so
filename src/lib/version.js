import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The plugin version from .claude-plugin/plugin.json, or null when the
// manifest is unreadable. Records carry it so a later reader can tell which
// rules and styles were in force.
export function pluginVersion(root = PKG_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}
