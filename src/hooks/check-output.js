#!/usr/bin/env node
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { run } from '../lib/hooks/check-output.js';

runHook(async () => {
  const out = run(await readStdinJson());
  if (!out) return;
  // `stderr` is a side channel, not hook JSON: warn-mode reports print there
  // so non-interactive runs surface them in the job log.
  const { stderr, ...rest } = out;
  if (stderr) process.stderr.write(stderr + '\n');
  if (Object.keys(rest).length > 0) emit(rest);
});
