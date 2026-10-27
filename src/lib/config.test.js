import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, merge, globalConfigPath, findProjectConfig, findLegacyKeys, configSnapshot, publishOn, DEFAULTS } from './config.js';

/*
 * Branch map — src/lib/config.js
 *   merge: over not an object → base · nested object → recurse · array/scalar → replace
 *   globalConfigPath: JUST_SAY_SO_CONFIG set · XDG_CONFIG_HOME set · neither → home default
 *   loadConfig: JUST_SAY_SO_FORCE_CONFIG set → merges over the project layer
 *   findProjectConfig: found in cwd · found by walking up · not found → null · no cwd → null
 *   loadConfig: no files → defaults · global only · project over global · malformed JSON → ignored
 *   findLegacyKeys: 0.8.x keys in any layer → [{file, keys}] · none → [] · malformed → skipped
 *   configSnapshot: the slice a record carries · publishOn: mode + a named source
 */

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jss-config-'));
}

describe('config', () => {
  describe('merge', () => {
    describe('when the override is not an object', () => {
      let result;

      beforeEach(() => {
        result = merge({ a: 1 }, null);
      });

      it('should return the base unchanged', () => {
        expect(result).toEqual({ a: 1 });
      });
    });

    describe('when the override nests objects and replaces arrays', () => {
      let result;

      beforeEach(() => {
        result = merge(
          { reminder: { mode: 'prompts', everyPrompts: 5 }, tools: ['Write', 'Edit'] },
          { reminder: { mode: 'tokens' }, tools: ['Write'] }
        );
      });

      it('should recurse into objects and replace the array wholesale', () => {
        expect(result).toEqual({ reminder: { mode: 'tokens', everyPrompts: 5 }, tools: ['Write'] });
      });
    });
  });

  describe('globalConfigPath', () => {
    describe('when JUST_SAY_SO_CONFIG is set', () => {
      let result;

      beforeEach(() => {
        result = globalConfigPath({ JUST_SAY_SO_CONFIG: '/etc/CAL_ZONE.json' });
      });

      it('should return it verbatim', () => {
        expect(result).toBe('/etc/CAL_ZONE.json');
      });
    });

    describe('when only XDG_CONFIG_HOME is set', () => {
      let result;

      beforeEach(() => {
        result = globalConfigPath({ XDG_CONFIG_HOME: '/xdg' });
      });

      it('should build the path under it', () => {
        expect(result).toBe('/xdg/just-say-so/just-say-so.json');
      });
    });

    describe('when neither variable is set', () => {
      let result;

      beforeEach(() => {
        result = globalConfigPath({});
      });

      it('should default under the home directory', () => {
        expect(result).toBe(path.join(os.homedir(), '.config', 'just-say-so', 'just-say-so.json'));
      });
    });
  });

  describe('findProjectConfig', () => {
    describe('when the file sits above the cwd', () => {
      let dir, result;

      beforeEach(() => {
        dir = tmpdir();
        fs.writeFileSync(path.join(dir, '.just-say-so.json'), '{}');
        const nested = path.join(dir, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        result = findProjectConfig(nested);
      });

      it('should find it by walking up', () => {
        expect(result).toBe(path.join(dir, '.just-say-so.json'));
      });
    });

    describe('when no file exists on the way to the root', () => {
      let result;

      beforeEach(() => {
        result = findProjectConfig(tmpdir());
      });

      it('should return null', () => {
        expect(result).toBe(null);
      });
    });

    describe('when no cwd is given', () => {
      let result;

      beforeEach(() => {
        result = findProjectConfig(null);
      });

      it('should return null', () => {
        expect(result).toBe(null);
      });
    });
  });

  describe('loadConfig', () => {
    describe('when no config files exist', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        result = loadConfig(dir, { JUST_SAY_SO_CONFIG: path.join(dir, 'MISSING.json') });
      });

      it('should return the defaults', () => {
        expect(result).toEqual(DEFAULTS);
      });
    });

    describe('when only a global config exists', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        const globalFile = path.join(dir, 'config.json');
        fs.writeFileSync(globalFile, JSON.stringify({ files: { show: 'error' } }));
        result = loadConfig(dir, { JUST_SAY_SO_CONFIG: globalFile });
      });

      it('should merge it over the defaults', () => {
        expect(result.files).toEqual({ ...DEFAULTS.files, show: 'error' });
      });

      it('should leave untouched sections at their defaults', () => {
        expect(result.publish).toEqual(DEFAULTS.publish);
      });
    });

    describe('when global and project configs both exist', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        const globalFile = path.join(dir, 'config.json');
        fs.writeFileSync(globalFile, JSON.stringify({ reminder: { mode: 'tokens', everyTokens: 9000 } }));
        fs.writeFileSync(path.join(dir, '.just-say-so.json'), JSON.stringify({ reminder: { mode: 'prompts' } }));
        result = loadConfig(dir, { JUST_SAY_SO_CONFIG: globalFile });
      });

      it('should let the project value win while keeping the global one it did not touch', () => {
        expect(result.reminder).toEqual({ ...DEFAULTS.reminder, mode: 'prompts', everyTokens: 9000 });
      });
    });

    describe('when a forced config is set alongside global and project files', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        const globalFile = path.join(dir, 'config.json');
        const forcedFile = path.join(dir, 'ci.json');
        fs.writeFileSync(globalFile, JSON.stringify({ files: { show: 'error' } }));
        fs.writeFileSync(
          path.join(dir, '.just-say-so.json'),
          JSON.stringify({ reply: { mode: 'off' }, publish: { mcp: ['mcp__jira__*'] } })
        );
        fs.writeFileSync(forcedFile, JSON.stringify({ reply: { mode: 'block' } }));
        result = loadConfig(dir, {
          JUST_SAY_SO_CONFIG: globalFile,
          JUST_SAY_SO_FORCE_CONFIG: forcedFile
        });
      });

      it('should let the forced fields beat the project while untouched fields fall through', () => {
        expect({ replyMode: result.reply.mode, mcp: result.publish.mcp, show: result.files.show }).toEqual({
          replyMode: 'block',
          mcp: ['mcp__jira__*'],
          show: 'error'
        });
      });
    });

    describe('when no cwd is given', () => {
      let result;

      beforeEach(() => {
        result = loadConfig(null, { JUST_SAY_SO_CONFIG: '/nope/MISSING.json' });
      });

      it('should skip the project lookup and return the defaults', () => {
        expect(result).toEqual(DEFAULTS);
      });
    });

    describe('when a config file holds malformed JSON', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        const globalFile = path.join(dir, 'config.json');
        fs.writeFileSync(globalFile, '{not json');
        result = loadConfig(dir, { JUST_SAY_SO_CONFIG: globalFile });
      });

      it('should ignore the file and return the defaults', () => {
        expect(result).toEqual(DEFAULTS);
      });
    });
  });

  describe('findLegacyKeys', () => {
    describe('when the personal and project files each set an old key', () => {
      let result, dir, globalFile;

      beforeEach(() => {
        dir = tmpdir();
        globalFile = path.join(dir, 'global.json');
        fs.writeFileSync(globalFile, JSON.stringify({ reminder: { mode: 'off' }, files: { mode: 'warn' } }));
        fs.writeFileSync(path.join(dir, '.just-say-so.json'), JSON.stringify({ bannedCheck: { mode: 'block' }, outputCheck: {} }));
        result = findLegacyKeys(dir, { JUST_SAY_SO_CONFIG: globalFile });
      });

      it('should list each file with the keys it still sets, in layer order', () => {
        expect(result).toEqual([
          { file: globalFile, keys: ['reminder'] },
          { file: path.join(dir, '.just-say-so.json'), keys: ['bannedCheck', 'outputCheck'] }
        ]);
      });
    });

    describe('when the files are current or malformed', () => {
      let result;

      beforeEach(() => {
        const dir = tmpdir();
        const globalFile = path.join(dir, 'global.json');
        fs.writeFileSync(globalFile, '{oops');
        fs.writeFileSync(path.join(dir, '.just-say-so.json'), JSON.stringify({ reply: { mode: 'block' } }));
        result = findLegacyKeys(dir, { JUST_SAY_SO_CONFIG: globalFile });
      });

      it('should report nothing', () => {
        expect(result).toEqual([]);
      });
    });
  });

  describe('configSnapshot', () => {
    describe('when given the defaults and a partial object', () => {
      let full, partial;

      beforeEach(() => {
        full = configSnapshot(DEFAULTS);
        partial = configSnapshot({ publish: { mcp: ['a', 'b'] } });
      });

      it('should carry the modes, the publish sources as a flag and a count, and onViolation', () => {
        expect({ full, partial }).toEqual({
          full: {
            files: { mode: 'warn' },
            publish: { mode: 'block', gh: false, mcp: 0, artifact: true },
            reply: { mode: 'warn' },
            rules: { onViolation: true }
          },
          partial: {
            files: { mode: null },
            publish: { mode: null, gh: null, mcp: 2, artifact: null },
            reply: { mode: null },
            rules: { onViolation: null }
          }
        });
      });
    });
  });

  describe('publishOn', () => {
    describe('when each shape is given', () => {
      let results;

      beforeEach(() => {
        results = [
          publishOn(DEFAULTS),
          publishOn({ publish: { mode: 'block', gh: true } }),
          publishOn({ publish: { mode: 'warn', mcp: ['mcp__x__*'] } }),
          publishOn({ publish: { mode: 'off', gh: true } }),
          publishOn({ publish: { mode: 'block', artifact: false } }),
          publishOn({})
        ];
      });

      it('should be on only with a source on and the mode not off', () => {
        expect(results).toEqual([true, true, true, false, false, false]);
      });
    });
  });
});
