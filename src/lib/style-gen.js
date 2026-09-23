// Generate the JustSaySo Vale style from rules/banned.json. The banned list
// stays the single source of truth: scripts/build-style.js regenerates the
// style, and a test fails when the committed files drift from the data.
import { termPattern } from './matcher.js';

const HEADER = '# Generated from rules/banned.json by scripts/build-style.js — do not edit by hand.\n';

// Vale scans raw text while the builtin matcher normalizes curly quotes
// first, so the emitted patterns accept either apostrophe.
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

// A hint of the form `use "X"` names a drop-in replacement, which Vale's
// substitution check carries per token. Any other hint is prose for the
// model and needs its own rule so the message survives.
function dropInReplacement(hint) {
  const m = /^use "([^"]+)"$/.exec(hint ?? '');
  return m ? m[1] : null;
}

function existenceRule({ message, level, tokens }) {
  return [
    HEADER,
    'extends: existence',
    `message: ${yamlString(message)}`,
    `level: ${level}`,
    'ignorecase: true',
    'nonword: true',
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
    'nonword: true',
    'swap:',
    ...Object.entries(swap).map(([k, v]) => `  ${yamlString(k)}: ${yamlString(v)}`),
    ''
  ].join('\n');
}

function token(term) {
  return curlyTolerant(termPattern(term));
}

/**
 * Build the JustSaySo style files from a banned-term set. Returns
 * { "Buzzwords.yml": content, ... }. Additions from user config are not
 * included — the style ships only what rules/banned.json ships.
 */
export function buildStyleFiles(banned) {
  const files = {};
  const plainTokens = [];
  const swap = {};
  const hinted = [];

  for (const entry of [...(banned.words ?? []), ...(banned.phrases ?? [])]) {
    const replacement = dropInReplacement(entry.hint);
    if (replacement) swap[token(entry.term)] = replacement;
    else if (entry.hint) hinted.push(entry);
    else plainTokens.push(entry);
  }

  const wordTerms = new Set((banned.words ?? []).map((e) => e.term));
  const buzzwords = plainTokens.filter((e) => wordTerms.has(e.term));
  const frames = plainTokens.filter((e) => !wordTerms.has(e.term));

  files['Buzzwords.yml'] = existenceRule({
    message: "Banned buzzword: '%s'. Use a precise domain term or delete it.",
    level: 'error',
    tokens: buzzwords.map((e) => token(e.term))
  });

  files['FillerFrames.yml'] = existenceRule({
    message: "Banned filler frame: '%s'. Delete it and state the point directly.",
    level: 'error',
    tokens: frames.map((e) => token(e.term))
  });

  if (Object.keys(swap).length > 0) {
    files['Substitutions.yml'] = substitutionRule({
      message: "Use '%s' instead of '%s'.",
      level: 'error',
      swap
    });
  }

  for (const entry of hinted) {
    files[`${ruleName(entry.term)}.yml`] = existenceRule({
      message: `Banned buzzword: '%s'. ${capitalize(entry.hint)}.`,
      level: 'error',
      tokens: [token(entry.term)]
    });
  }

  files['NegativeParallelism.yml'] = existenceRule({
    message: "Banned frame: '%s'. State the positive claim directly.",
    level: 'error',
    tokens: (banned.patterns ?? []).map((p) => curlyTolerant(p.regex))
  });

  files['Intensifiers.yml'] = existenceRule({
    message: "Empty intensifier: '%s'. Replace it with a measurement or a concrete consequence.",
    level: 'suggestion',
    tokens: (banned.contextual ?? []).map((e) => token(e.term))
  });

  return files;
}

function capitalize(s) {
  const t = String(s).replace(/\.$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
