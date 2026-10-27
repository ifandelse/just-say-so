import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  // Each target is one kind of text the model produces. A target's Vale
  // rules live in .vale.ini, keyed by the name the text lints under; the
  // config here only says what the plugin does with the result.
  files: {
    mode: 'warn', // "off" | "warn" | "block" — warn: edit-time facts; block adds the Stop gate
    show: 'suggestion' // lowest alert level passed to the model at edit time: "error" | "warning" | "suggestion"
  },
  publish: {
    mode: 'block', // "off" | "warn" | "block" — nothing can un-publish, so block is the default once a source is on
    gh: false, // check the gh commands that publish prose (pr/issue/release create|comment|edit|review, gh api)
    mcp: [], // MCP tool-name patterns to check, e.g. "mcp__confluence__*"
    // A published value the extractor cannot read (an expansion, stdin, a
    // heredoc): "ask" prompts the user; "allow" and "deny" answer without
    // one. Under an automatic-permission harness mode, "ask" acts as
    // "allow" — a prompt nobody answers is a deny in headless runs.
    unresolved: 'ask' // "ask" | "allow" | "deny"
  },
  reply: {
    mode: 'warn' // "off" | "warn" | "block" — warn: count broken rules, report with the next rules injection; block: rewrite
  },
  rules: {
    // Where the rules text goes out. Context start covers every source the
    // harness reports; trim the list to inject on fewer. onViolation sends
    // the rules plus the reply report on the prompt after a reply broke one.
    onContextStart: ['startup', 'resume', 'clear', 'compact'],
    onSubagentStart: true,
    onViolation: true,
    manifest: null, // your own rules manifest, replaces rules/manifest.json
    extra: null, // a manifest fragment whose sections are appended to the one in force
    messagesPath: null // overrides hook message strings, per key (rules/messages.json)
  },
  vale: {
    config: null // path to a .vale.ini; default: nearest above the checked file, else the shipped fallback
  },
  events: {
    // The events log: one line per session start, rules injection, checked
    // reply, rejection, and allowed term, in the state directory. Rule names
    // and counts only. "off" writes nothing and skips the log-only reply lint.
    mode: 'on' // "on" | "off"
  }
};

// Keys the 0.8.x config used. A file that still sets them configures
// nothing now, so session start names them once.
const LEGACY_KEYS = ['reminder', 'bannedCheck', 'outputCheck'];

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

// The config files in force for a cwd, in precedence order.
export function configFiles(cwd, env) {
  const files = [globalConfigPath(env)];
  const projectFile = cwd ? findProjectConfig(cwd) : null;
  if (projectFile) files.push(projectFile);
  if (env.JUST_SAY_SO_FORCE_CONFIG) files.push(env.JUST_SAY_SO_FORCE_CONFIG);
  return files;
}

// [{ file, keys }] for each config file that still sets a 0.8.x key.
export function findLegacyKeys(cwd, env = process.env) {
  const out = [];
  for (const file of configFiles(cwd, env)) {
    const json = readJson(file);
    if (!isObject(json)) continue;
    const keys = LEGACY_KEYS.filter((k) => k in json);
    if (keys.length > 0) out.push({ file, keys });
  }
  return out;
}

// The slice of config an events or rejection record carries.
export function configSnapshot(config) {
  return {
    files: { mode: config.files?.mode ?? null },
    publish: { mode: config.publish?.mode ?? null, gh: config.publish?.gh ?? null, mcp: (config.publish?.mcp ?? []).length },
    reply: { mode: config.reply?.mode ?? null },
    rules: { onViolation: config.rules?.onViolation ?? null }
  };
}

// Whether any publish source is named and the mode is not off.
export function publishOn(config) {
  const p = config.publish ?? {};
  return p.mode !== 'off' && (p.gh === true || (p.mcp ?? []).length > 0);
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
