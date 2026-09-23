import fs from 'node:fs';
import path from 'node:path';
import { findProjectConfig } from './config.js';
import { findValeConfig } from './vale.js';

// A multiword term is a collocation ("robust regression") → allowPhrases;
// a single token is a whole-term exemption → disableWords.
export function listFor(term) {
  return /\s/.test(term.trim()) ? 'allowPhrases' : 'disableWords';
}

// A Vale config that names both StylesPath and Vocab can take the term
// natively: Vale adds every accept.txt entry to the exception list of every
// active rule, across all styles. The ini subset we parse is a flat
// `key = value` line; that covers every config Vale's own docs show.
function vocabTarget(cwd) {
  const configFile = findValeConfig(cwd);
  if (!configFile) return null;
  let text;
  try {
    text = fs.readFileSync(configFile, 'utf8');
  } catch {
    return null;
  }
  const stylesPath = /^\s*StylesPath\s*=\s*(.+?)\s*$/m.exec(text)?.[1];
  const vocab = /^\s*Vocab\s*=\s*(.+?)\s*$/m.exec(text)?.[1];
  if (!stylesPath || !vocab) return null;
  return path.join(path.dirname(configFile), stylesPath, 'config', 'vocabularies', vocab, 'accept.txt');
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
  return { method: 'vocabulary', file, term, added };
}

function addToConfig(term, cwd) {
  const existing = findProjectConfig(cwd);
  const file = existing ?? path.join(cwd, '.just-say-so.json');
  const config = existing ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  const list = listFor(term);
  const bannedCheck = (config.bannedCheck ??= {});
  const terms = (bannedCheck[list] ??= []);
  const added = !terms.some((t) => String(t).toLowerCase() === term.toLowerCase());
  if (added) terms.push(term);

  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { method: 'config', file, list, term, added };
}

/**
 * Permit a term the checker flagged. Preferred destination: the project's
 * Vale vocabulary (accept.txt), when a .vale.ini above cwd names StylesPath
 * and Vocab. Otherwise the term goes to .just-say-so.json as before — the
 * hooks apply disableWords/allowPhrases to Vale alerts, so both routes
 * exempt the term. Throws on a malformed existing config file rather than
 * clobbering it.
 */
export function addAllowTerm(term, cwd) {
  const cleaned = String(term ?? '').trim();
  if (!cleaned) throw new Error('no term given');

  const vocabFile = vocabTarget(cwd);
  if (vocabFile) return addToVocabulary(vocabFile, cleaned);
  return addToConfig(cleaned, cwd);
}
