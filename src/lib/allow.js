import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { findValeConfig } from './vale.js';
import { logEvent } from './events.js';

// The vocabulary a project gets when its .vale.ini names none. Not
// "JustSaySo": a package that ships a vocabulary of the same name would
// overwrite it on vale sync.
export const DEFAULT_VOCAB = 'Project';

// The ini subset we read is a flat `key = value` line; that covers every
// config Vale's own docs show.
function readKey(text, key) {
  return new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'm').exec(text)?.[1] ?? null;
}

// Insert `key = value` before the first section header, so it lands in the
// global block where Vale reads it.
function insertKey(text, key, value) {
  const line = `${key} = ${value}\n`;
  const at = text.search(/^\s*\[/m);
  if (at === -1) return text.replace(/\n?$/, '\n') + line;
  return text.slice(0, at) + line + text.slice(at);
}

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
  let stylesPath = readKey(text, 'StylesPath');
  if (!stylesPath) {
    stylesPath = 'styles';
    text = insertKey(text, 'StylesPath', stylesPath);
  }
  let vocab = readKey(text, 'Vocab');
  if (!vocab) {
    vocab = DEFAULT_VOCAB;
    text = insertKey(text, 'Vocab', vocab);
  }
  const configChanged = text !== original;
  if (configChanged) fs.writeFileSync(configFile, text);
  return {
    file: path.join(path.dirname(configFile), stylesPath, 'config', 'vocabularies', vocab, 'accept.txt'),
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
  const added = !lines.some((l) => l.trim().toLowerCase() === term.toLowerCase());
  if (added) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [...lines, term].join('\n') + '\n');
  }
  return added;
}

/**
 * Permit a term the checker flagged: append it to the project's Vale
 * vocabulary (accept.txt). Vale adds every accepted entry to the exception
 * list of every active rule, across all styles, and a multiword entry
 * exempts only that collocation. The same file serves the editor, the
 * commit hook, CI, and the hooks, so there is no second place to look.
 */
export function addAllowTerm(term, cwd, env = process.env) {
  const cleaned = String(term ?? '').trim();
  if (!cleaned) throw new Error('no term given');

  const target = vocabTarget(cwd);
  const added = addToVocabulary(target.file, cleaned);
  const result = { term: cleaned, file: target.file, added, configFile: target.configFile, configChanged: target.configChanged };
  // The CLI runs outside a hook, so the session id is whatever the harness
  // exported; null when it exported nothing.
  logEvent(
    'allow',
    { session: env.CLAUDE_SESSION_ID ?? null, project: cwd ?? null, term: cleaned, file: target.file, added },
    { config: loadConfig(cwd, env), env }
  );
  return result;
}
