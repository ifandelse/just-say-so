// Generate the JustSaySo Vale style from the rules manifest. The manifest
// stays the single source of truth: scripts/build.js regenerates the
// style, and a test fails when the committed files drift from the data.
// The rules never set `nonword`: a nonword rule ignores the Vale
// vocabulary (verified on 3.24), and the vocabulary is the only exemption
// route. The lookarounds in each token keep the hyphen guard without it.
import { styleSpecs, dropInReplacement } from './manifest.js';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Hyphen counts as a word character at the boundary, so "robust" does not
// match inside "robust-websocket" and terms never match inside identifiers.
const BEFORE = '(?<![\\w-])';
const AFTER = '(?![\\w-])';

// One pattern for words and phrases: tokens split on space/hyphen and
// rejoin tolerant of either, so "load bearing" also catches "load-bearing".
// Curly quotes in a term normalize to straight before escaping.
export function termPattern(term) {
  const tokens = String(term ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  return BEFORE + tokens.join('[\\s\\u00A0-]+') + AFTER;
}

const HEADER = '# Generated from rules/manifest.json by scripts/build.js — do not edit by hand.\n';

// Models write curly quotes, so the emitted patterns accept either
// apostrophe.
function curlyTolerant(pattern) {
  return pattern.replace(/'/g, "['’]");
}

function yamlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function ruleName(term) {
  return term
    .split(/[\s-]+/)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).replace(/[^A-Za-z0-9]/g, ''))
    .join('');
}

function existenceRule({ message, level, tokens }) {
  return [
    HEADER,
    'extends: existence',
    `message: ${yamlString(message)}`,
    `level: ${level}`,
    'ignorecase: true',
    'tokens:',
    ...tokens.map((t) => `  - ${yamlString(t)}`),
    ''
  ].join('\n');
}

function substitutionRule({ message, level, swap }) {
  return [
    HEADER,
    'extends: substitution',
    `message: ${yamlString(message)}`,
    `level: ${level}`,
    'ignorecase: true',
    'swap:',
    ...Object.entries(swap).map(([k, v]) => `  ${yamlString(k)}: ${yamlString(v)}`),
    ''
  ].join('\n');
}

function token(term) {
  return curlyTolerant(termPattern(term));
}

/**
 * Build the JustSaySo style files from the manifest's style blocks.
 * Returns { "Buzzwords.yml": content, ... }. Each block becomes one
 * existence rule named after it. A term with a drop-in hint (`use "to"`)
 * moves to the shared Substitutions rule, which carries the replacement;
 * a term with any other hint gets a rule of its own named after the term,
 * so the hint survives as the message. A term with `checkedBy` is
 * skipped. Patterns are raw regexes.
 */
export function buildStyleFiles(manifest) {
  const files = {};
  const swap = {};

  for (const spec of styleSpecs(manifest)) {
    const tokens = [];
    for (const entry of spec.terms ?? []) {
      // A term a bundled rule already reports stays in the rules text and
      // out of this style, so one word raises one alert.
      if (entry.checkedBy) continue;
      const replacement = dropInReplacement(entry.hint);
      if (replacement) swap[token(entry.term)] = replacement;
      else if (entry.hint) {
        files[`${ruleName(entry.term)}.yml`] = existenceRule({
          message: `${spec.message.split(':')[0]}: '%s'. ${capitalize(entry.hint)}.`,
          level: spec.level,
          tokens: [token(entry.term)]
        });
      } else tokens.push(token(entry.term));
    }
    for (const p of spec.patterns ?? []) tokens.push(curlyTolerant(p.regex));
    files[`${spec.name}.yml`] = existenceRule({ message: spec.message, level: spec.level, tokens });
  }

  if (Object.keys(swap).length > 0) {
    files['Substitutions.yml'] = substitutionRule({ message: "Use '%s' instead of '%s'.", level: 'error', swap });
  }
  return files;
}

function capitalize(s) {
  const t = String(s).replace(/\.$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
