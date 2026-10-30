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

// A stand-in vale binary for spawned-process tests: answers ls-dirs, sync,
// --version, and ls-config, and "lints" the target file by flagging every line containing "leverage" or
// "synergy" in real Vale JSON shape. Integration must not depend on a real
// vale install.
const FAKE_VALE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'ls-dirs' || args[0] === 'sync') process.exit(0);
if (args[0] === '--version') { process.stdout.write('vale version 0.0.0-fake\\n'); process.exit(0); }
if (args[0] === 'ls-config') {
  // The minimum shape the resolver reads: the shipped mapping, no styles.
  // JSS_FAKE_LS_CONFIG names a JSON file to answer with instead.
  if (process.env.JSS_FAKE_LS_CONFIG) { process.stdout.write(fs.readFileSync(process.env.JSS_FAKE_LS_CONFIG, 'utf8')); process.exit(0); }
  process.stdout.write(JSON.stringify({ Formats: { reply: 'md', publish: 'md' }, GBaseStyles: [], GChecks: {}, SBaseStyles: {}, SChecks: {}, RuleToLevel: {}, SLevels: {}, Paths: [], ConfigFiles: [] }));
  process.exit(0);
}
const target = args[args.length - 1];
if (process.env.JSS_FAKE_LINT_FAIL) process.exit(2);
let text;
try { text = fs.readFileSync(target, 'utf8'); } catch { process.exit(2); }
// The vocabulary in force: accept.txt under the config's StylesPath and
// Vocab. The word rule (JustSaySo.Buzzwords) honours an entry that holds
// the matched term; the nonword rule (acme.Armed) and the sequence rule
// (acme.Verbs) ignore it, the way real Vale does.
let accepted = [];
const configArg = args.find((a) => a.startsWith('--config='));
if (configArg) {
  const path = require('node:path');
  const configFile = configArg.slice('--config='.length);
  try {
    const ini = fs.readFileSync(configFile, 'utf8');
    const stylesPath = (/^StylesPath\\s*=\\s*(.+)$/m.exec(ini) || [])[1];
    const vocab = (/^Vocab\\s*=\\s*(.+)$/m.exec(ini) || [])[1];
    if (stylesPath && vocab) {
      accepted = fs.readFileSync(path.resolve(path.dirname(configFile), stylesPath.trim(), 'config', 'vocabularies', vocab.trim(), 'accept.txt'), 'utf8').split('\\n').filter(Boolean);
    }
  } catch {}
}
const alerts = [];
text.split('\\n').forEach((line, i) => {
  for (const [term, check, message, honours] of [
    ['leverage', 'JustSaySo.Buzzwords', "Banned buzzword: 'leverage'.", true],
    ['synergy', 'JustSaySo.Buzzwords', "Banned buzzword: 'synergy'.", true],
    ['armed', 'acme.Armed', "Enforcement metaphor: 'armed'. Say what the check refuses.", false],
    ['navigate', 'acme.Verbs', "AI vocabulary (verb form): 'navigate'. Replace with a direct verb.", false]
  ]) {
    const at = line.toLowerCase().indexOf(term);
    if (at === -1) continue;
    if (honours && accepted.some((e) => line.includes(e) && e.toLowerCase().includes(term))) continue;
    alerts.push({
      Check: check, Severity: 'error', Line: i + 1,
      Span: [at + 1, at + term.length], Match: line.substr(at, term.length),
      Message: message
    });
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
