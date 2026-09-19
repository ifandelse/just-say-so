#!/usr/bin/env node
// Add a term to this project's just-say-so allow list. Consent lives with
// whoever invokes this — the /just-say-so:allow skill or a user-approved
// Bash call — so the script itself just does the edit, deterministically.
import { addAllowTerm } from '../lib/allow.js';

const term = process.argv.slice(2).join(' ').trim();
if (!term) {
  console.error('usage: allow.js <term or collocation>');
  process.exit(1);
}

try {
  const result = addAllowTerm(term, process.cwd());
  console.log(
    result.added
      ? `just-say-so: added "${result.term}" to ${result.list} in ${result.file}`
      : `just-say-so: "${result.term}" is already in ${result.list} (${result.file})`
  );
} catch (err) {
  console.error(`just-say-so: could not update config: ${err.message}`);
  process.exit(1);
}
