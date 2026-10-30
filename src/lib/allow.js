import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { findValeConfig, resolveValeConfig, lintText, REPLY_NAME } from './vale.js';
import { readKey, setKey } from './vale-ini.js';
import { logEvent } from './events.js';
import { lsConfig } from './rule-state.js';
import { listStyleFiles } from './style-inventory.js';
import { describeRule } from './undescribed.js';

// The vocabulary a project gets when its .vale.ini names none. Not
// "JustSaySo": a package that ships a vocabulary of the same name would
// overwrite it on vale sync.
export const DEFAULT_VOCAB = 'Project';

/**
 * The accept.txt a term goes to, creating the Vocab (and StylesPath) keys
 * in the nearest .vale.ini when it lacks them. Returns { file, configFile,
 * configChanged }. Throws when no .vale.ini sits above cwd: the plugin's
 * fallback config is not a file to write into, and the project needs its
 * own before it can hold exceptions.
 */
export function vocabTarget(cwd) {
  const configFile = findValeConfig(cwd);
  if (!configFile) {
    throw new Error(`no .vale.ini above ${cwd}; add one with the JustSaySo package first (see the README)`);
  }
  let text = fs.readFileSync(configFile, 'utf8');
  const original = text;
  // An empty key is replaced in place: Vale reads the later of two lines.
  let stylesPath = readKey(text, 'StylesPath');
  if (!stylesPath) {
    stylesPath = 'styles';
    text = setKey(text, 'StylesPath', stylesPath);
  }
  let vocab = readKey(text, 'Vocab');
  if (!vocab) {
    vocab = DEFAULT_VOCAB;
    text = setKey(text, 'Vocab', vocab);
  }
  const configChanged = text !== original;
  if (configChanged) fs.writeFileSync(configFile, text);
  // StylesPath is relative to the config file, or absolute. Resolve keeps both.
  return {
    file: path.join(path.resolve(path.dirname(configFile), stylesPath), 'config', 'vocabularies', vocab, 'accept.txt'),
    configFile,
    configChanged
  };
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.length ? lines.join('\n') + '\n' : '');
}

// Vale reads each entry as a case-sensitive expression, so a capitalised
// entry and a lowercase one are two exemptions. Compare exactly, or the
// second is lost.
function addToVocabulary(file, term) {
  const lines = readLines(file);
  const added = !lines.some((l) => l.trim() === term);
  if (added) writeLines(file, [...lines, term]);
  return added;
}

function removeFromVocabulary(file, term) {
  writeLines(file, readLines(file).filter((l) => l.trim() !== term));
}

// Why a rule ignores the vocabulary, from its file: a nonword rule
// matches across word boundaries, a sequence rule matches by part of
// speech. Vale skips the vocabulary for both (verified on 3.24). Any
// other case is reported as plain fact.
function reasonFor(id, file) {
  let yaml = '';
  try {
    yaml = fs.readFileSync(file, 'utf8');
  } catch {
    // an unreadable rule file gets the generic reason
  }
  if (/^nonword:\s*true\s*$/m.test(yaml)) return 'nonword';
  if (describeRule(id, file).extends === 'sequence') return 'sequence';
  return 'other';
}

function lintTerm(term, configPath, env) {
  const alerts = lintText(`${term}\n`, { name: REPLY_NAME, configPath, env });
  if (alerts === null) return null;
  const seen = new Map();
  for (const a of alerts) if (!seen.has(a.Check)) seen.set(a.Check, a.Message);
  return seen;
}

/**
 * The rules that report `term` on its own under the project's config, as
 * [{ id, message }]. Returns null when vale cannot lint here.
 */
export function reportingRules(term, cwd, env = process.env, config = loadConfig(cwd, env)) {
  const configPath = resolveValeConfig(cwd, config);
  if (!lsConfig(configPath, env)) return null;
  const seen = lintTerm(term, configPath, env);
  return seen === null ? null : [...seen].map(([id, message]) => ({ id, message }));
}

/**
 * Permit a term the checker flagged: append it to the project's Vale
 * vocabulary (accept.txt). Vale adds every accepted entry to the exception
 * list of every rule that honours the vocabulary, across all styles, and
 * a multiword entry exempts only that collocation. The same file serves
 * the editor, the commit hook, CI, and the hooks, so there is no second
 * place to look.
 *
 * Which rules the entry silences is measured, not assumed: the term is
 * linted before and after the write. A rule that went quiet is
 * `honoured`; a rule that reports the term after the write, whether or
 * not the first lint showed it (two rules on one span fold to one), is
 * `unreachable`, with the reason read from its file. When no reporting
 * rule goes quiet, the entry is removed again, because a silent no-op is
 * worse than a refusal. Both lists are null when vale could not lint
 * the term here.
 */
export function addAllowTerm(term, cwd, env = process.env) {
  // A quoted sentence arrives with its final period, and an entry that
  // ends in a period matches nothing (Vale compares the entry with the
  // words around the flagged term), so trailing punctuation goes.
  const cleaned = String(term ?? '').trim().replace(/[.!?,;:]+$/, '').trim();
  if (!cleaned) throw new Error('no term given');

  const target = vocabTarget(cwd);
  const config = loadConfig(cwd, env);
  const configPath = resolveValeConfig(cwd, config);
  const resolved = lsConfig(configPath, env);
  const before = resolved ? lintTerm(cleaned, configPath, env) : null;

  const present = readLines(target.file).some((l) => l.trim() === cleaned);
  const added = addToVocabulary(target.file, cleaned);
  let honoured = null;
  let unreachable = null;
  let written = true;
  if (before !== null) {
    const after = lintTerm(cleaned, configPath, env) ?? new Map();
    const files = listStyleFiles(resolved.Paths ?? []);
    honoured = [...before.keys()].filter((id) => !after.has(id));
    unreachable = [...after].map(([id, message]) => ({ id, message, reason: reasonFor(id, files.get(id)) }));
    if (before.size > 0 && honoured.length === 0) {
      written = false;
      if (added) removeFromVocabulary(target.file, cleaned);
    }
  }
  const result = {
    term: cleaned,
    file: target.file,
    added: written && added,
    present,
    written,
    honoured,
    unreachable,
    configFile: target.configFile,
    configChanged: target.configChanged
  };
  // The CLI runs outside a hook, so the session id is whatever the harness
  // exported, or null when it exported nothing.
  logEvent(
    'allow',
    {
      session: env.CLAUDE_SESSION_ID ?? null,
      project: cwd ?? null,
      term: cleaned,
      file: target.file,
      added: result.added,
      unreachable: unreachable === null ? null : unreachable.map((r) => r.id)
    },
    { config, env }
  );
  return result;
}

const REASONS = {
  nonword: 'matches text across word boundaries, and Vale ignores the project',
  sequence: 'matches by part of speech, and Vale ignores the project',
  other: 'is one for which Vale ignores the project'
};

/** The lines the CLI prints for an allow result. */
export function formatAllow(result) {
  const L = [];
  const quoted = `"${result.term}"`;
  if (result.written) {
    L.push(
      result.added
        ? `just-say-so: added ${quoted} to the Vale vocabulary (${result.file})`
        : `just-say-so: ${quoted} is already in the Vale vocabulary (${result.file})`
    );
    if (result.configChanged) L.push(`just-say-so: added StylesPath/Vocab to ${result.configFile}`);
    if (result.honoured === null) {
      L.push('just-say-so: vale could not lint the term here, so which rules the entry silences is unknown. Run /just-say-so:doctor.');
    } else if (result.honoured.length === 0) {
      L.push('just-say-so: no active rule reports the term on its own, so nothing changes until one does.');
    } else {
      L.push(`just-say-so: ${result.honoured.join(', ')} no longer reports it (checked by linting the term again).`);
    }
  }
  if (result.unreachable && result.unreachable.length > 0) {
    const ids = result.unreachable.map((r) => r.id);
    const one = ids.length === 1;
    const kinds = new Set(result.unreachable.map((r) => r.reason));
    const reason = kinds.size === 1 ? REASONS[[...kinds][0]] : REASONS.other;
    L.push(
      '',
      `${quoted} is ${result.written ? 'still ' : ''}reported by ${ids.join(' and ')}.`,
      '',
      `${one ? 'That rule' : 'Each of those rules'} ${reason}`,
      `vocabulary (accept.txt) for it. An entry there changes nothing for`,
      `${one ? 'it' : 'them'}${result.written ? '.' : ', so the entry was not kept.'}`,
      '',
      'You have two ways out:',
      '',
      '  1. Rewrite the phrase.'
    );
    for (const r of result.unreachable) L.push(`     ${r.id}: ${r.message}`);
    L.push(
      '',
      `  2. Turn the rule off for this project. This is per rule, not per phrase:`,
      `     every match of the rule stops. Add under [*] in .vale.ini:`,
      ''
    );
    for (const id of ids) L.push(`       ${id} = NO`);
    L.push('', '     To turn it off for one target only, put the line under [*.reply] or', '     [*.md] instead.');
  }
  return L.join('\n') + '\n';
}
