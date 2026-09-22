import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  reminder: {
    mode: 'prompts', // "prompts" | "tokens" | "off"
    everyPrompts: 5,
    everyTokens: 4000,
    // Rules are present at the start of every context, then refreshed every
    // N prompts. Trim this list to inject on fewer SessionStart sources.
    onSessionStart: ['startup', 'resume', 'clear', 'compact'],
    // Subagents start with fresh context and never see the main-session
    // reminders; brief them at spawn too.
    onSubagentStart: true
  },
  bannedCheck: {
    mode: 'warn', // "warn" | "block" | "off" — warn by default, like a linter; block is the opt-in hard gate
    addons: [], // opt-in coverage bundles; "gh" is the only shipped one
    mcpTools: [], // MCP tool-name patterns to check, e.g. "mcp__confluence__*"
    exclude: ['**/package*.json', '**/*.lock', '**/node_modules/**', '**/*.min.*'],
    include: [],
    disableWords: [],
    allowPhrases: [],
    additions: { words: [], phrases: [], patterns: [] }
  },
  outputCheck: {
    mode: 'off' // "off" | "warn" | "block"
  },
  rules: {
    fullPath: null,
    condensedPath: null,
    messagesPath: null
  }
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Objects merge recursively; arrays and scalars replace.
export function merge(base, over) {
  if (!isObject(over)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = isObject(value) && isObject(base?.[key]) ? merge(base[key], value) : value;
  }
  return out;
}

export function globalConfigPath(env = process.env) {
  if (env.JUST_SAY_SO_CONFIG) return env.JUST_SAY_SO_CONFIG;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'just-say-so', 'just-say-so.json');
}

// Nearest .just-say-so.json from cwd upward wins.
export function findProjectConfig(cwd) {
  let dir = cwd ? path.resolve(cwd) : null;
  while (dir) {
    const candidate = path.join(dir, '.just-say-so.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function loadConfig(cwd, env = process.env) {
  let config = merge(DEFAULTS, readJson(globalConfigPath(env)));
  const projectFile = cwd ? findProjectConfig(cwd) : null;
  if (projectFile) config = merge(config, readJson(projectFile));
  // The forced layer beats everything — CI points it at a committed file so
  // a mode in the project config can never silently weaken the CI policy.
  if (env.JUST_SAY_SO_FORCE_CONFIG) config = merge(config, readJson(env.JUST_SAY_SO_FORCE_CONFIG));
  return config;
}
