#!/usr/bin/env node
// Add a term to this project's Vale vocabulary. Consent lives with whoever
// invokes this (the /just-say-so:allow skill or a user-approved Bash call),
// so the script itself just does the edit, deterministically, and says
// which rules the entry covers and which it cannot.
import { addAllowTerm, formatAllow } from '../lib/allow.js';

const term = process.argv.slice(2).join(' ').trim();
if (!term) {
  console.error('usage: allow.js <term or collocation>');
  process.exit(1);
}

try {
  process.stdout.write(formatAllow(addAllowTerm(term, process.cwd())));
} catch (err) {
  console.error(`just-say-so: could not add the term: ${err.message}`);
  process.exit(1);
}
