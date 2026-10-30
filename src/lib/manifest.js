// The rules manifest: one JSON source for the rules text the model reads
// and the JustSaySo Vale style that checks part of it. rules/full.md,
// rules/condensed.md, and styles/JustSaySo/ are rendered from it by
// scripts/build.js, and a test fails when any of them drift. Each rule
// carries `vale`, the Vale rules that check it; an empty list marks a
// judgment rule that no linter sees. A project adds rules of its own
// through rules.extra, and replaces the whole manifest through
// rules.manifest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function shippedManifestPath() {
  return path.join(PKG_ROOT, 'rules', 'manifest.json');
}

function expandHome(p) {
  if (p && p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// A rule-file path from a config file. Relative paths are relative to
// the project the config describes, not to wherever the command ran,
// because the summary reports on other projects and hooks run from a
// cwd Claude chooses. Absolute and home paths stay as written.
export function ruleFilePath(p, cwd) {
  return path.resolve(cwd, expandHome(p));
}

// The extra file a project gets without a setting: this name in the
// project root, or in a directory above the working one, found the way
// .just-say-so.json is.
export const DEFAULT_EXTRA = '.just-say-so-rules.json';

export function findDefaultExtra(cwd) {
  let dir = cwd ? path.resolve(cwd) : null;
  while (dir) {
    const candidate = path.join(dir, DEFAULT_EXTRA);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * The extra file in force: { path, source: "config" | "default" }, or
 * null. A configured path wins; otherwise the default name is looked for.
 */
export function extraFile(config, cwd = process.cwd()) {
  const configured = config?.rules?.extra;
  if (configured) return { path: ruleFilePath(configured, cwd), source: 'config' };
  const found = findDefaultExtra(cwd);
  return found ? { path: found, source: 'default' } : null;
}

/**
 * Merge an extra file into a manifest. An extra bullet whose id matches a
 * shipped one replaces it in place; one with `drop: true` removes it;
 * any other is appended under the extra file's own sections. The
 * condensed order follows: a replaced bullet keeps its slot while it has
 * a short text, a dropped one leaves, and a new one with a short text
 * joins the end. Returns { manifest, added, replaced, dropped, unknownDrops }.
 */
export function mergeExtra(manifest, extra) {
  const shippedIds = new Set(allRules(manifest).map((r) => r.id));
  const replace = new Map();
  const drop = new Set();
  const unknownDrops = [];
  const newSections = [];
  for (const section of extra?.sections ?? []) {
    const fresh = [];
    for (const rule of section.rules ?? []) {
      if (!rule || typeof rule.id !== 'string') continue;
      if (rule.drop === true) {
        if (shippedIds.has(rule.id)) drop.add(rule.id);
        else unknownDrops.push(rule.id);
      } else if (shippedIds.has(rule.id)) replace.set(rule.id, rule);
      else fresh.push(rule);
    }
    if (fresh.length) newSections.push({ ...section, rules: fresh });
  }
  const sections = (manifest.sections ?? [])
    .map((s) => ({ ...s, rules: (s.rules ?? []).filter((r) => !drop.has(r.id)).map((r) => replace.get(r.id) ?? r) }))
    .concat(newSections);
  const byId = new Map(sections.flatMap((s) => s.rules ?? []).map((r) => [r.id, r]));
  const kept = (manifest.condensed ?? []).filter((id) => !drop.has(id) && (!byId.has(id) || byId.get(id).short));
  const joined = [...replace.keys(), ...newSections.flatMap((s) => s.rules.map((r) => r.id))].filter((id) => byId.get(id)?.short && !kept.includes(id));
  return {
    manifest: { ...manifest, sections, condensed: [...kept, ...joined] },
    added: newSections.flatMap((s) => s.rules.map((r) => r.id)),
    replaced: [...replace.keys()],
    dropped: [...drop],
    unknownDrops
  };
}

/**
 * The base manifest: the file rules.manifest names, or the shipped one.
 * A missing or malformed override falls back to the shipped manifest and
 * reports the problem, so a typo in a path never leaves a session without
 * rules. Returns { manifest, problem }, problem being null or
 * { file, error } with error "does not exist" or "cannot be read as JSON".
 */
export function readManifest(config, cwd = process.cwd()) {
  const override = config?.rules?.manifest;
  if (!override) return { manifest: readJson(shippedManifestPath()), problem: null };
  const file = ruleFilePath(override, cwd);
  try {
    return { manifest: readJson(file), problem: null };
  } catch (e) {
    const error = e?.code === 'ENOENT' ? 'does not exist' : 'cannot be read as JSON';
    return { manifest: readJson(shippedManifestPath()), problem: { file, error } };
  }
}

/** The rules.manifest problem in force, or null. */
export function manifestProblem(config, cwd = process.cwd()) {
  return readManifest(config, cwd).problem;
}

/**
 * The manifest in force: the base (see readManifest) with the extra file
 * merged in (see mergeExtra). A missing or malformed extra file is
 * ignored. `cwd` is the project directory relative paths resolve against
 * and the default extra file is looked for from.
 */
export function loadManifest(config, cwd = process.cwd()) {
  const { manifest } = readManifest(config, cwd);
  const extra = loadExtra(config, cwd);
  return extra ? mergeExtra(manifest, extra).manifest : manifest;
}

/** The extra manifest fragment alone, or null when none is in force or readable. */
export function loadExtra(config, cwd = process.cwd()) {
  const file = extraFile(config, cwd);
  if (!file) return null;
  try {
    return readJson(file.path);
  } catch {
    return null;
  }
}

export function allRules(manifest) {
  return (manifest.sections ?? []).flatMap((s) => s.rules ?? []);
}

function ruleById(manifest) {
  return new Map(allRules(manifest).map((r) => [r.id, r]));
}

// A hint of the form `use "X"` names a drop-in replacement and shows in
// the rules text; any other hint is for the Vale message alone.
export function dropInReplacement(hint) {
  const m = /^use "([^"]+)"$/.exec(hint ?? '');
  return m ? m[1] : null;
}

// The {terms} placeholder: the style's term list as the rules text shows
// it. Quoted terms read as a run of quoted phrases with the comma inside
// the quotes; plain terms read as a comma list. A drop-in hint follows
// its term in parentheses.
function termsText(style) {
  const terms = style?.terms ?? [];
  const suffix = (t) => {
    const r = dropInReplacement(t.hint);
    return r ? ` (use "${r}")` : '';
  };
  if (terms.some((t) => t.quote)) {
    return terms
      .map((t, i) => (i < terms.length - 1 ? `"${t.term},"` : `"${t.term}"`) + suffix(t))
      .join(' ');
  }
  return terms.map((t) => t.term + suffix(t)).join(', ');
}

function ruleText(rule, kind) {
  const text = kind === 'condensed' ? rule.short : rule.full;
  return String(text ?? '').replace('{terms}', termsText(rule.style));
}

// The "Checked by" trailer of a bullet. A short list is named in full; a
// long one, which the bundled packages make common, gives the count and
// the first few names so the text stays readable.
const CHECKED_NAMED = 4;
function checkedBy(ids) {
  if (ids.length === 0) return '';
  if (ids.length <= CHECKED_NAMED) return ` Checked by ${ids.join(', ')}.`;
  return ` Checked by ${ids.length} Vale rules, among them ${ids.slice(0, CHECKED_NAMED - 1).join(', ')}.`;
}

/**
 * Render the rules text. kind "full" renders every section with its
 * title and note, and names the Vale rules that check a bullet after it.
 * kind "condensed" renders the reminder: the ids in `condensed`, in that
 * order, minus `drop`. `append` adds a closing paragraph.
 */
export function renderRules(manifest, kind, { drop = new Set(), append = null } = {}) {
  const lines = [];
  if (kind === 'condensed') {
    lines.push(`## ${manifest.title} — reminder`, '', manifest.intro, '');
    const byId = ruleById(manifest);
    for (const id of manifest.condensed ?? []) {
      const rule = byId.get(id);
      if (!rule || !rule.short || drop.has(id)) continue;
      lines.push(`- ${ruleText(rule, 'condensed')}`);
    }
    if (append) lines.push('', append);
    return lines.join('\n') + '\n';
  }

  lines.push(`## ${manifest.title}`, '', manifest.intro);
  for (const section of manifest.sections ?? []) {
    lines.push('', `### ${section.title}`, '');
    if (section.note) lines.push(section.note, '');
    for (const rule of section.rules ?? []) {
      if (drop.has(rule.id)) continue;
      const checked = checkedBy(rule.vale ?? []);
      lines.push(section.prose ? ruleText(rule, 'full') + checked : `- ${ruleText(rule, 'full')}${checked}`);
    }
  }
  if (append) lines.push('', append);
  return lines.join('\n') + '\n';
}

/** Every Vale rule id a manifest names, deduplicated. */
export function valeIds(manifest) {
  return [...new Set(allRules(manifest).flatMap((r) => r.vale ?? []))];
}

/** The `style` blocks that generate the JustSaySo style, in manifest order. */
export function styleSpecs(manifest) {
  return allRules(manifest)
    .filter((r) => r.style)
    .map((r) => r.style);
}

/** The terms the JustSaySo style bans, as written in the manifest. */
export function fixedTerms(manifest) {
  return styleSpecs(manifest).flatMap((s) => (s.terms ?? []).map((t) => t.term));
}
