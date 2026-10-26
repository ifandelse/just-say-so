import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginVersion, PKG_ROOT } from './version.js';

/*
 * Branch map — src/lib/version.js
 *   pluginVersion: manifest readable → its version · manifest without a
 *     version → null · unreadable → null
 */

describe('version', () => {
  describe('when the shipped manifest is read', () => {
    let result, expected;

    beforeEach(() => {
      result = pluginVersion();
      expected = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    });

    it('should return the version in plugin.json', () => {
      expect(result).toBe(expected);
    });
  });

  describe('when the manifest has no version field', () => {
    let result;

    beforeEach(() => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-version-'));
      fs.mkdirSync(path.join(root, '.claude-plugin'));
      fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{"name":"x"}');
      result = pluginVersion(root);
    });

    it('should return null', () => {
      expect(result).toBeNull();
    });
  });

  describe('when the manifest is missing', () => {
    let result;

    beforeEach(() => {
      result = pluginVersion(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-version-')));
    });

    it('should return null', () => {
      expect(result).toBeNull();
    });
  });
});
