import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Fresh filesystem sandbox per suite: isolated config + state, nothing
// touches the developer's real ~/.config or state directories.
export function makeSandbox(config) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-'));
  const configFile = path.join(work, 'config.json');
  if (config) fs.writeFileSync(configFile, JSON.stringify(config));
  const stateDir = path.join(work, 'state');
  return {
    work,
    stateDir,
    configFile,
    env: { JUST_SAY_SO_CONFIG: configFile, JUST_SAY_SO_STATE_DIR: stateDir }
  };
}

export function writeTranscript(dir, name, entries) {
  const file = path.join(dir, name);
  const lines = entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

// A stand-in vale binary for spawned-process tests: answers ls-dirs, and
// "lints" the target file by flagging every line containing "leverage" or
// "synergy" in real Vale JSON shape. Integration must not depend on a real
// vale install.
const FAKE_VALE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'ls-dirs') process.exit(0);
const target = args[args.length - 1];
let text;
try { text = fs.readFileSync(target, 'utf8'); } catch { process.exit(2); }
const alerts = [];
text.split('\\n').forEach((line, i) => {
  for (const term of ['leverage', 'synergy']) {
    const at = line.toLowerCase().indexOf(term);
    if (at !== -1) {
      alerts.push({
        Check: 'JustSaySo.Buzzwords', Severity: 'error', Line: i + 1,
        Span: [at + 1, at + term.length], Match: line.substr(at, term.length),
        Message: "Banned buzzword: '" + term + "'."
      });
    }
  }
});
process.stdout.write(JSON.stringify(alerts.length ? { [target]: alerts } : {}));
process.exit(alerts.length ? 1 : 0);
`;

export function withFakeVale(sandbox) {
  const bin = path.join(sandbox.work, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, 'vale');
  fs.writeFileSync(script, FAKE_VALE, { mode: 0o755 });
  return { ...sandbox, env: { ...sandbox.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}
