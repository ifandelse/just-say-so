// The bundled Vale packages: rules/packages.json names each pinned
// release and the settings the plugin ships for its rules. The vendor
// script (scripts/vendor-packages.js) downloads and unpacks them into
// styles/<name>/, byte for byte; the build renders the settings into the
// style sections of vale/fallback.ini and the repository's own .vale.ini
// between two marker lines, so one file decides what every target lints
// under and the committed configs cannot drift from it.
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from './version.js';

export const MARK_BEGIN = '# --- generated from rules/packages.json by scripts/build.js; do not edit by hand ---';
export const MARK_END = '# --- end generated ---';

// The style the manifest generates, always first in every list.
export const OWN_STYLE = 'JustSaySo';

// Where the bundled styles apply: prose formats, chat replies, and
// published fragments. Code files keep JustSaySo alone under [*], so a
// comment is checked for the banned list and nothing wider. A project's
// own [*.md] section restates the list and so drops the bundle for that
// format, the same way it always dropped JustSaySo.
export const PROSE_GLOB = '{*.md,*.mdx,*.markdown,*.txt,*.rst,*.adoc,*.asciidoc,*.html,*.htm,*.reply,*.publish}';

export function shippedPackagesPath() {
  return path.join(PKG_ROOT, 'rules', 'packages.json');
}

export function readPackages(file = shippedPackagesPath()) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The style names in list order: JustSaySo, then each bundled package. */
export function styleNames(packages) {
  return [OWN_STYLE, ...(packages.packages ?? []).map((p) => p.name)];
}

/**
 * The per-rule setting lines, sorted by id: `Style.Rule = NO` or
 * `Style.Rule = level`. Anything but NO, error, warning, or suggestion
 * is a mistake in the file and throws, so the build cannot write a
 * config Vale rejects.
 */
export function ruleSettingLines(packages) {
  const out = [];
  for (const [id, value] of Object.entries(packages.rules ?? {})) {
    if (!['NO', 'error', 'warning', 'suggestion'].includes(value)) {
      throw new Error(`rules/packages.json: ${id} is set to "${value}"; use NO, error, warning, or suggestion`);
    }
    out.push(`${id} = ${value}`);
  }
  return out.sort();
}

/**
 * The generated block: markers, [*] with JustSaySo and the NO settings,
 * then the prose section with every bundled style and the level
 * settings. A NO under [*] reaches every section; a level line enables
 * the rule wherever it sits, so the levels stay in the prose section.
 */
export function renderValeSections(packages) {
  const settings = ruleSettingLines(packages);
  const lines = [MARK_BEGIN, '[*]', `BasedOnStyles = ${OWN_STYLE}`];
  lines.push(...settings.filter((l) => l.endsWith(' = NO')));
  lines.push('', `[${PROSE_GLOB}]`, `BasedOnStyles = ${styleNames(packages).join(', ')}`);
  lines.push(...settings.filter((l) => !l.endsWith(' = NO')));
  lines.push('', MARK_END);
  return lines.join('\n');
}

/**
 * `text` with the block between the markers replaced by `block`. Throws
 * when either marker is missing, so a config that lost its markers is
 * fixed by hand rather than silently left alone.
 */
export function spliceGenerated(text, block) {
  const begin = text.indexOf(MARK_BEGIN);
  const end = text.indexOf(MARK_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`the config has no "${MARK_BEGIN}" ... "${MARK_END}" block to replace`);
  }
  return text.slice(0, begin) + block + text.slice(end + MARK_END.length);
}

/**
 * The files of one style inside a package archive, as [{ rel, data }]
 * with `rel` relative to the style directory. A package zip holds either
 * a bare style (Name/Rule.yml) or a complete package
 * (Name/styles/Name/Rule.yml, with config/ beside the style); only the
 * style directory is taken.
 */
export function styleEntries(entries, name) {
  const complete = entries.some((e) => e.name.split('/').filter(Boolean).slice(0, 2).join('/') === `${name}/styles`);
  const out = [];
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    let rel = null;
    if (complete) {
      if (parts.length >= 4 && parts[0] === name && parts[1] === 'styles' && parts[2] === name) rel = parts.slice(3);
    } else if (parts.length >= 2 && parts[0] === name) rel = parts.slice(1);
    if (rel && rel.length > 0) out.push({ rel: rel.join('/'), data: entry.data });
  }
  return out;
}

/** The rule ids (Style.Rule) a vendored style directory defines, sorted. */
export function vendoredRuleIds(stylesDir, name) {
  const dir = path.join(stylesDir, name);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => `${name}.${f.slice(0, -4)}`)
    .sort();
}
