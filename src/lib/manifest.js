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

/**
 * The manifest in force: the shipped one, or the file rules.manifest
 * names, with the sections of rules.extra appended. An extra file holds
 * the same shape (sections of rules); its rules with a `short` text join
 * the condensed reminder after the shipped ones. A missing or malformed
 * extra file is ignored, so a typo in a project file never breaks a hook.
 * `cwd` is the project directory relative paths resolve against.
 */
export function loadManifest(config, cwd = process.cwd()) {
  const override = config?.rules?.manifest;
  const manifest = readJson(override ? ruleFilePath(override, cwd) : shippedManifestPath());
  const extraPath = config?.rules?.extra;
  if (!extraPath) return manifest;
  let extra;
  try {
    extra = readJson(ruleFilePath(extraPath, cwd));
  } catch {
    return manifest;
  }
  const sections = [...(manifest.sections ?? []), ...(extra.sections ?? [])];
  const extraIds = (extra.sections ?? []).flatMap((s) => (s.rules ?? []).filter((r) => r.short).map((r) => r.id));
  return { ...manifest, sections, condensed: [...(manifest.condensed ?? []), ...extraIds] };
}

/** The rules.extra manifest fragment alone, or null when none is set or readable. */
export function loadExtra(config, cwd = process.cwd()) {
  const extraPath = config?.rules?.extra;
  if (!extraPath) return null;
  try {
    return readJson(ruleFilePath(extraPath, cwd));
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
      const checked = (rule.vale ?? []).length > 0 ? ` Checked by ${rule.vale.join(', ')}.` : '';
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
