import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stateDir, readSession, writeSession, resetSession, cleanupSessions } from './state.js';

/*
 * Branch map — src/lib/state.js
 *   stateDir: JUST_SAY_SO_STATE_DIR · CLAUDE_PLUGIN_DATA · XDG_STATE_HOME · home default
 *   readSession: valid file → merged over FRESH · missing → FRESH · corrupt JSON → FRESH
 *   writeSession: creates nested directories
 *   resetSession: overwrites with FRESH
 *   cleanupSessions: sessions dir missing → return · old file removed · fresh file kept ·
 *                    unlink failure → caught
 */

const FRESH = {
  promptCount: 0,
  contextAtLastReminder: null,
  pendingNotes: [],
  projectDir: null,
  valeFiles: {},
  lastStopBlock: null
};

function tmpEnv() {
  return { JUST_SAY_SO_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jss-state-')) };
}

describe('state', () => {
  describe('stateDir', () => {
    describe('when each environment override is set', () => {
      let explicit, pluginData, xdg, home;

      beforeEach(() => {
        explicit = stateDir({ JUST_SAY_SO_STATE_DIR: '/explicit' });
        pluginData = stateDir({ CLAUDE_PLUGIN_DATA: '/plugin-data' });
        xdg = stateDir({ XDG_STATE_HOME: '/xdg-state' });
        home = stateDir({});
      });

      it('should resolve each precedence branch', () => {
        expect({ explicit, pluginData, xdg, home }).toEqual({
          explicit: '/explicit',
          pluginData: path.join('/plugin-data', 'state'),
          xdg: path.join('/xdg-state', 'just-say-so'),
          home: path.join(os.homedir(), '.local', 'state', 'just-say-so')
        });
      });
    });
  });

  describe('readSession', () => {
    describe('when no session file exists', () => {
      let result;

      beforeEach(() => {
        result = readSession('GHOST_SESSION', tmpEnv());
      });

      it('should return a fresh session', () => {
        expect(result).toEqual(FRESH);
      });
    });

    describe('when a session file exists with partial data', () => {
      let result;

      beforeEach(() => {
        const env = tmpEnv();
        writeSession('CAL_ZONE', { promptCount: 7 }, env);
        result = readSession('CAL_ZONE', env);
      });

      it('should merge the stored fields over the fresh defaults', () => {
        expect(result).toEqual({ ...FRESH, promptCount: 7 });
      });
    });

    describe('when the session file holds corrupt JSON', () => {
      let result;

      beforeEach(() => {
        const env = tmpEnv();
        const file = path.join(stateDir(env), 'sessions', 'BROKEN.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{oops');
        result = readSession('BROKEN', env);
      });

      it('should fall back to a fresh session', () => {
        expect(result).toEqual(FRESH);
      });
    });
  });

  describe('writeSession', () => {
    describe('when the session id contains unsafe characters', () => {
      let result;

      beforeEach(() => {
        const env = tmpEnv();
        writeSession('a/b:c d', { promptCount: 1 }, env);
        result = fs.readdirSync(path.join(stateDir(env), 'sessions'));
      });

      it('should sanitize the file name', () => {
        expect(result).toEqual(['a_b_c_d.json']);
      });
    });
  });

  describe('resetSession', () => {
    describe('when a session already holds state', () => {
      let result;

      beforeEach(() => {
        const env = tmpEnv();
        writeSession('BUSY', { promptCount: 42, pendingNotes: ['NOTE'] }, env);
        resetSession('BUSY', env);
        result = readSession('BUSY', env);
      });

      it('should overwrite it with a fresh session', () => {
        expect(result).toEqual(FRESH);
      });
    });
  });

  describe('cleanupSessions', () => {
    describe('when the sessions directory does not exist', () => {
      let error;

      beforeEach(() => {
        try {
          cleanupSessions(tmpEnv());
        } catch (e) {
          error = e;
        }
      });

      it('should return without throwing', () => {
        expect(error).toBe(undefined);
      });
    });

    describe('when old and fresh session files coexist', () => {
      let remaining;

      beforeEach(() => {
        const env = tmpEnv();
        writeSession('OLD_TIMER', { promptCount: 1 }, env);
        writeSession('FRESH_FACE', { promptCount: 1 }, env);
        const oldFile = path.join(stateDir(env), 'sessions', 'OLD_TIMER.json');
        const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
        fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);
        cleanupSessions(env);
        remaining = fs.readdirSync(path.join(stateDir(env), 'sessions'));
      });

      it('should remove only the old file', () => {
        expect(remaining).toEqual(['FRESH_FACE.json']);
      });
    });

    describe('when an entry cannot be unlinked', () => {
      let error, remaining;

      beforeEach(() => {
        const env = tmpEnv();
        // A directory inside sessions/: stat succeeds, unlink throws, catch survives.
        const decoy = path.join(stateDir(env), 'sessions', 'DECOY_DIR');
        fs.mkdirSync(decoy, { recursive: true });
        const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
        fs.utimesSync(decoy, eightDaysAgo, eightDaysAgo);
        try {
          cleanupSessions(env);
        } catch (e) {
          error = e;
        }
        remaining = fs.readdirSync(path.join(stateDir(env), 'sessions'));
      });

      it('should swallow the failure and leave the entry', () => {
        expect({ error, remaining }).toEqual({ error: undefined, remaining: ['DECOY_DIR'] });
      });
    });
  });
});
