import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { findValeConfig, resolveValeConfig, lintText, REPLY_NAME } from './vale.js';
import { readKey, setKey } from './vale-ini.js';
import { logEvent } from './events.js';
import { lsConfig } from './rule-state.js';
import { listNonwordRules } from './style-inventory.js';

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

function addToVocabulary(file, term) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    // a missing accept.txt starts empty
  }
  // Vale reads each entry as a case-sensitive expression, so a capitalised
  // entry and a lowercase one are two exemptions. Compare exactly, or the
  // second is lost.
  const added = !lines.some((l) => l.trim() === term);
  if (added) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [...lines, term].join('\n') + '\n');
  }
  return added;
}

/**
 * The rules that report `term` on its own under the project's config, as
 * [{ id, message, nonword }]. A nonword rule matches across word
 * boundaries, and Vale ignores the vocabulary for rules written that way
 * (verified on 3.24), so an accept entry never applies to it. Returns null
 * when vale cannot lint here, in which case the caller writes the entry
 * as it always did.
 */
export function reportingRules(term, cwd, env = process.env, config = loadConfig(cwd, env)) {
  const configPath = resolveValeConfig(cwd, config);
  const resolved = lsConfig(configPath, env);
  if (!resolved) return null;
  const alerts = lintText(`${term}\n`, { name: REPLY_NAME, configPath, env });
  if (alerts === null) return null;
  const nonword = listNonwordRules(resolved.Paths ?? []);
  const seen = new Map();
  for (const a of alerts) {
    if (!seen.has(a.Check)) seen.set(a.Check, { id: a.Check, message: a.Message, nonword: nonword.has(a.Check) });
  }
  return [...seen.values()];
}

/**
 * Permit a term the checker flagged: append it to the project's Vale
 * vocabulary (accept.txt). Vale adds every accepted entry to the exception
 * list of every active rule that honours the vocabulary, across all
 * styles, and a multiword entry exempts only that collocation. The same
 * file serves the editor, the commit hook, CI, and the hooks, so there is
 * no second place to look.
 *
 * When every rule that reports the term is nonword, nothing is written:
 * the entry would change nothing, and a silent no-op is worse than a
 * refusal. The result says which rules the entry reaches (`honoured`) and
 * which it cannot (`unreachable`), or null for both when vale could not
 * lint the term here.
 */
export function addAllowTerm(term, cwd, env = process.env) {
  const cleaned = String(term ?? '').trim();
  if (!cleaned) throw new Error('no term given');

  const target = vocabTarget(cwd);
  const config = loadConfig(cwd, env);
  const reporting = reportingRules(cleaned, cwd, env, config);
  const honoured = reporting === null ? null : reporting.filter((r) => !r.nonword).map((r) => r.id);
  const unreachable = reporting === null ? null : reporting.filter((r) => r.nonword);
  const written = reporting === null || reporting.length === 0 || honoured.length > 0;
  const added = written ? addToVocabulary(target.file, cleaned) : false;
  const result = {
    term: cleaned,
    file: target.file,
    added,
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
      added,
      unreachable: unreachable === null ? null : unreachable.map((r) => r.id)
    },
    { config, env }
  );
  return result;
}

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
      L.push(`just-say-so: ${result.honoured.join(', ')} will no longer report it.`);
    }
  }
  if (result.unreachable && result.unreachable.length > 0) {
    const ids = result.unreachable.map((r) => r.id);
    L.push(
      '',
      `${quoted} is reported by ${ids.join(' and ')}.`,
      '',
      `${ids.length === 1 ? 'That rule matches' : 'Those rules match'} text across word boundaries, and Vale ignores the project`,
      'vocabulary (accept.txt) for rules written that way. An entry there changes',
      `nothing for ${ids.length === 1 ? 'it' : 'them'}${result.written ? '.' : ', so nothing was written.'}`,
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
