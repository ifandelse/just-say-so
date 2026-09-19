import fs from 'node:fs';
import path from 'node:path';
import { findProjectConfig } from './config.js';

// A multiword term is a collocation ("robust regression") → allowPhrases;
// a single token is a whole-term exemption → disableWords.
export function listFor(term) {
  return /\s/.test(term.trim()) ? 'allowPhrases' : 'disableWords';
}

/**
 * Add a term to the project's .just-say-so.json — the nearest one walking up
 * from cwd, or a new file in cwd. Preserves everything else in the config.
 * Throws on a malformed existing file rather than clobbering it.
 */
export function addAllowTerm(term, cwd) {
  const cleaned = String(term ?? '').trim();
  if (!cleaned) throw new Error('no term given');

  const existing = findProjectConfig(cwd);
  const file = existing ?? path.join(cwd, '.just-say-so.json');
  const config = existing ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  const list = listFor(cleaned);
  const bannedCheck = (config.bannedCheck ??= {});
  const terms = (bannedCheck[list] ??= []);
  const added = !terms.some((t) => String(t).toLowerCase() === cleaned.toLowerCase());
  if (added) terms.push(cleaned);

  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { file, list, term: cleaned, added };
}
