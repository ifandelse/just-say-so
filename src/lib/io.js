import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from './state.js';

export async function readStdinJson(stream = process.stdin) {
  let data = '';
  for await (const chunk of stream) data += chunk;
  return JSON.parse(data);
}

export function emit(obj, stream = process.stdout) {
  stream.write(JSON.stringify(obj));
}

// Hook entry wrapper: any failure exits 0 with nothing on stdout, because
// a broken style check must never block the user's prompt or tool call.
// The failure is not silent: one line goes to stderr and one JSON line to
// hook-errors.jsonl in the state directory, where the doctor counts them.
// No process.exit(): exiting while stdout is a pipe can truncate the JSON
// mid-write; letting the event loop drain flushes it and still exits 0.
export function runHook(main, { name = path.basename(process.argv[1] ?? 'hook'), env = process.env, now = new Date() } = {}) {
  return main().catch((e) => {
    recordHookError(name, e, env, now);
  });
}

export function hookErrorsFile(env = process.env) {
  return path.join(stateDir(env), 'hook-errors.jsonl');
}

export function recordHookError(name, e, env = process.env, now = new Date()) {
  const message = String(e?.message ?? e);
  try {
    process.stderr.write(`just-say-so: ${name} failed: ${message}\n`);
  } catch {
    // stderr may be closed; the file below is the record
  }
  try {
    const file = hookErrorsFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ t: now.toISOString(), hook: name, message, stack: String(e?.stack ?? '').split('\n').slice(0, 4).join('\n') }) + '\n');
  } catch {
    // the state directory may be unwritable; exiting 0 still matters more
  }
}

/** Hook errors recorded since `since` (ISO), newest last. */
export function readHookErrors(env = process.env, since = null) {
  let text;
  try {
    text = fs.readFileSync(hookErrorsFile(env), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (!since || rec.t >= since) out.push(rec);
    } catch {
      // a torn line is skipped
    }
  }
  return out;
}
