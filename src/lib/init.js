// Project setup in one pass: a .vale.ini that loads the JustSaySo package,
// a synced styles directory, a .just-say-so.json for the modes the user
// chose, and the commit gate wired into whatever hook tooling the repo
// already has. Each step reports what it did or what it left for the user,
// and --dry-run reports without writing. The doctor report follows, so a
// run ends with the effective rules per target in front of the user.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findProjectConfig } from './config.js';
import { findValeConfig } from './vale.js';
import { readKey, insertKey, withPackage, packageUrl } from './vale-ini.js';
import { DEFAULT_VOCAB } from './allow.js';
import { pluginVersion } from './version.js';

const MODES = new Set(['off', 'warn', 'block']);
const HOOKS = new Set(['auto', 'pre-commit', 'husky', 'git', 'none']);

export function parseArgs(argv) {
  const opts = { mcp: [], hook: 'auto', dryRun: false };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--files' || a === '--publish' || a === '--reply') {
      const v = next();
      if (!MODES.has(v)) errors.push(`${a} takes off, warn, or block`);
      else opts[a.slice(2)] = v;
    } else if (a === '--gh') opts.gh = true;
    else if (a === '--mcp') {
      const v = next();
      if (!v) errors.push('--mcp takes a tool-name pattern');
      else opts.mcp.push(v);
    } else if (a === '--hook') {
      const v = next();
      if (!HOOKS.has(v)) errors.push(`--hook takes ${[...HOOKS].join(', ')}`);
      else opts.hook = v;
    } else if (a === '--dry-run') opts.dryRun = true;
    else errors.push(`unknown argument ${a}`);
  }
  return { opts, errors };
}

function repoRoot(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

const FRESH_INI = (url) =>
  [
    '# Vale config for this project. just-say-so wrote the first version;',
    '# edit freely. The JustSaySo package supplies the [formats] mapping and',
    '# the [*.reply] and [*.publish] sections; add your own rules below.',
    'StylesPath = styles',
    'MinAlertLevel = suggestion',
    `Vocab = ${DEFAULT_VOCAB}`,
    `Packages = ${url}`,
    '',
    '[*]',
    'BasedOnStyles = JustSaySo',
    ''
  ].join('\n');

// Vale fails outright (E100) when Vocab names a vocabulary that has no
// directory, so the key and the accept file are written together.
function ensureVocabulary(configFile, stylesPath, vocab, write) {
  const accept = path.join(path.dirname(configFile), stylesPath, 'config', 'vocabularies', vocab, 'accept.txt');
  if (fs.existsSync(accept)) return null;
  if (write) {
    fs.mkdirSync(path.dirname(accept), { recursive: true });
    fs.writeFileSync(accept, '');
  }
  return `${write ? 'created' : 'would create'} ${accept}`;
}

// Write or amend the Vale config. Returns the lines to report.
function setupValeConfig(root, url, write) {
  const existing = findValeConfig(root);
  if (!existing) {
    const file = path.join(root, '.vale.ini');
    if (write) fs.writeFileSync(file, FRESH_INI(url));
    const lines = [`${write ? 'wrote' : 'would write'} ${file} with the JustSaySo package, StylesPath = styles, and Vocab = ${DEFAULT_VOCAB}`];
    const made = ensureVocabulary(file, 'styles', DEFAULT_VOCAB, write);
    if (made) lines.push(made);
    return { file, lines };
  }
  let text = fs.readFileSync(existing, 'utf8');
  const lines = [];
  const pinned = withPackage(text, url);
  if (pinned.changed) {
    text = pinned.text;
    lines.push(`${write ? 'pinned' : 'would pin'} the JustSaySo package at ${url} in ${existing}`);
  }
  if (!readKey(text, 'StylesPath')) {
    text = insertKey(text, 'StylesPath', 'styles');
    lines.push(`${write ? 'added' : 'would add'} StylesPath = styles to ${existing}`);
  }
  if (!readKey(text, 'Vocab')) {
    text = insertKey(text, 'Vocab', DEFAULT_VOCAB);
    lines.push(`${write ? 'added' : 'would add'} Vocab = ${DEFAULT_VOCAB} to ${existing}`);
  }
  if (lines.length === 0) lines.push(`${existing} already loads the JustSaySo package at this version`);
  else if (write) fs.writeFileSync(existing, text);
  const made = ensureVocabulary(existing, readKey(text, 'StylesPath'), readKey(text, 'Vocab'), write);
  if (made) lines.push(made);
  return { file: existing, lines };
}

function syncStyles(root, write, env) {
  if (!write) return ['would run vale sync'];
  const r = spawnSync('vale', ['sync'], { cwd: root, encoding: 'utf8', timeout: 120_000, env });
  if (r.error) return ['vale sync skipped: vale is not on PATH. Install it and run vale sync in the repo.'];
  if (r.status !== 0) return [`vale sync failed (exit ${r.status}): ${String(r.stderr || r.stdout).trim().split('\n').pop()}`];
  return ['ran vale sync'];
}

function setupPluginConfig(root, opts, write) {
  const patch = {};
  if (opts.files) patch.files = { mode: opts.files };
  if (opts.publish || opts.gh || opts.mcp.length > 0) {
    patch.publish = {};
    if (opts.publish) patch.publish.mode = opts.publish;
    if (opts.gh) patch.publish.gh = true;
    if (opts.mcp.length > 0) patch.publish.mcp = opts.mcp;
  }
  if (opts.reply) patch.reply = { mode: opts.reply };
  if (Object.keys(patch).length === 0) return ['no plugin settings given, so the defaults apply (files warn, publish block with no source, reply warn)'];

  const existing = findProjectConfig(root);
  const file = existing ?? path.join(root, '.just-say-so.json');
  let current = {};
  if (existing) {
    try {
      current = JSON.parse(fs.readFileSync(existing, 'utf8'));
    } catch {
      return [`${existing} is not valid JSON; fix it by hand and rerun`];
    }
  }
  const merged = { ...current };
  for (const [k, v] of Object.entries(patch)) merged[k] = { ...(current[k] ?? {}), ...v };
  if (write) fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return [`${write ? (existing ? 'updated' : 'wrote') : existing ? 'would update' : 'would write'} ${file}: ${JSON.stringify(patch)}`];
}

const PRE_COMMIT_SNIPPET = (tag) =>
  ['repos:', '  - repo: https://github.com/ifandelse/just-say-so', `    rev: ${tag}`, '    hooks:', '      - id: vale-staged'].join('\n');

const GIT_HOOK = `#!/bin/sh
# just-say-so commit gate: Vale on the lines this commit adds.
# Skip once with JUST_SAY_SO_PRECOMMIT=0 git commit ...
if [ -x node_modules/.bin/just-say-so-staged ]; then
  exec node_modules/.bin/just-say-so-staged
fi
echo "just-say-so: the commit gate is not installed. Run: npm install --save-dev github:ifandelse/just-say-so#TAG" >&2
exit 0
`;

// Wire the commit gate for the tooling the repo has. Only plain files are
// written; a package manager or a YAML config is reported, never edited.
function setupHook(root, mode, tag, write) {
  const hasPreCommit = fs.existsSync(path.join(root, '.pre-commit-config.yaml'));
  const hasHusky = fs.existsSync(path.join(root, '.husky'));
  const hasPackage = fs.existsSync(path.join(root, 'package.json'));
  const hasGit = fs.existsSync(path.join(root, '.git'));
  const chosen =
    mode !== 'auto' ? mode : hasPreCommit ? 'pre-commit' : hasHusky ? 'husky' : hasPackage ? 'git' : hasGit ? 'pre-commit' : 'none';
  const devDep = `npm install --save-dev github:ifandelse/just-say-so#${tag}`;

  if (chosen === 'none') return ['commit gate: skipped'];
  if (chosen === 'pre-commit') {
    return [
      `commit gate: add this to .pre-commit-config.yaml${hasPreCommit ? '' : ' (the file does not exist yet)'} and run pre-commit install:`,
      ...PRE_COMMIT_SNIPPET(tag).split('\n').map((l) => `    ${l}`)
    ];
  }
  if (chosen === 'husky') {
    const hook = path.join(root, '.husky', 'pre-commit');
    const line = 'node_modules/.bin/just-say-so-staged';
    const current = fs.existsSync(hook) ? fs.readFileSync(hook, 'utf8') : '';
    const lines = [];
    if (current.includes(line)) lines.push(`commit gate: ${hook} already runs the gate`);
    else {
      if (write) {
        fs.mkdirSync(path.dirname(hook), { recursive: true });
        fs.writeFileSync(hook, current.replace(/\n?$/, current ? '\n' : '') + line + '\n');
      }
      lines.push(`commit gate: ${write ? 'added' : 'would add'} "${line}" to ${hook}`);
    }
    lines.push(`commit gate: the gate comes from the dev dependency; run: ${devDep}`);
    return lines;
  }
  // chosen === 'git'
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  if (!hasGit) return ['commit gate: no .git directory here, nothing to install'];
  if (fs.existsSync(hook)) return [`commit gate: ${hook} exists; add "node_modules/.bin/just-say-so-staged" to it by hand`, `commit gate: run: ${devDep}`];
  if (write) fs.writeFileSync(hook, GIT_HOOK.replace('TAG', tag), { mode: 0o755 });
  return [`commit gate: ${write ? 'wrote' : 'would write'} ${hook}`, `commit gate: the gate comes from the dev dependency; run: ${devDep}`];
}

/**
 * Run the setup. Returns { root, lines } where lines report each step.
 * Throws only on bad arguments.
 */
export function runInit(cwd, argv, env = process.env) {
  const { opts, errors } = parseArgs(argv);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const write = !opts.dryRun;
  const root = repoRoot(cwd);
  const version = pluginVersion() ?? '0.0.0';
  const tag = `v${version}`;
  const lines = [`project root: ${root}${write ? '' : ' (dry run, nothing written)'}`];
  lines.push(...setupValeConfig(root, packageUrl(version), write).lines);
  lines.push(...syncStyles(root, write, env));
  lines.push(...setupPluginConfig(root, opts, write));
  lines.push(...setupHook(root, opts.hook, tag, write));
  return { root, lines };
}
