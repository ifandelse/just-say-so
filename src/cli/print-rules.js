#!/usr/bin/env node
// Print the resolved rules text ("full" or "condensed"), honoring config
// overrides. The skills call this; harnesses without hooks can call it too.
import { loadConfig } from '../lib/config.js';
import { readRules } from '../lib/rules.js';

const kind = process.argv[2] === 'condensed' ? 'condensed' : 'full';
process.stdout.write(readRules(kind, loadConfig(process.cwd())));
