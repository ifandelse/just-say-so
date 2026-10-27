import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listStyleRules, listStyleFiles } from './style-inventory.js';

/*
 * Branch map — src/lib/style-inventory.js
 *   nested rule files → dotted names · level read from the YAML, default
 *   warning · config and dot-directories skipped · missing directory
 *   skipped · several directories merge
 */

describe('style-inventory', () => {
  describe('listStyleRules', () => {
    describe('when two directories hold styles with nested rules and odd entries', () => {
      let rules, files;

      beforeEach(() => {
        const a = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-inv-a-'));
        const b = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-inv-b-'));
        fs.mkdirSync(path.join(a, 'Tells', 'sub'), { recursive: true });
        fs.writeFileSync(path.join(a, 'Tells', 'Dash.yml'), 'extends: existence\nlevel: error\n');
        fs.writeFileSync(path.join(a, 'Tells', 'sub', 'Deep.yml'), "extends: existence\nlevel: 'suggestion'\n");
        fs.writeFileSync(path.join(a, 'Tells', 'NoLevel.yml'), 'extends: existence\n');
        fs.writeFileSync(path.join(a, 'Tells', 'README.md'), 'not a rule');
        fs.mkdirSync(path.join(a, 'config', 'vocabularies', 'P'), { recursive: true });
        fs.writeFileSync(path.join(a, 'config', 'vocabularies', 'P', 'accept.txt'), 'x\n');
        fs.mkdirSync(path.join(a, '.vale-config'));
        fs.writeFileSync(path.join(a, '.vale-config', '0-X.ini'), '[*]\n');
        fs.writeFileSync(path.join(a, 'stray.yml'), 'level: error\n');
        fs.mkdirSync(path.join(b, 'Plain'));
        fs.writeFileSync(path.join(b, 'Plain', 'Passive.yml'), 'level: warning\n');
        rules = listStyleRules([a, path.join(a, 'MISSING'), b, null]);
        files = listStyleFiles([a, b]);
      });

      it('should map every rule to its file', () => {
        expect([...files.keys()].sort()).toEqual(['Plain.Passive', 'Tells.Dash', 'Tells.NoLevel', 'Tells.sub.Deep']);
        expect(files.get('Tells.sub.Deep')).toMatch(/Tells\/sub\/Deep\.yml$/);
      });

      it('should map every rule file to its level and skip everything else', () => {
        expect([...rules.entries()].sort()).toEqual([
          ['Plain.Passive', 'warning'],
          ['Tells.Dash', 'error'],
          ['Tells.NoLevel', 'warning'],
          ['Tells.sub.Deep', 'suggestion']
        ]);
      });
    });
  });
});
