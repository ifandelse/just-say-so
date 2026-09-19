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
