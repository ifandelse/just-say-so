#!/usr/bin/env node
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { run } from '../lib/hooks/check-output.js';

runHook(async () => {
  const out = run(await readStdinJson());
  if (out) emit(out);
});
