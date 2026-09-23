import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { mockSpawnSync } = vi.hoisted(() => ({ mockSpawnSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

import { run, isPolicyFile } from './pre-gate.js';
import { writeSession } from '../state.js';
import { makeSandbox } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/pre-gate.js
 *   file tools: unknown tool → null · no file path → null · non-policy file → null ·
 *     policy file (.just-say-so.json / vale configs / vocab accept.txt / global /
 *     forced) → ask · mode off → null
 *   publish check (Bash/MCP): mode off → null · gh addon absent → null ·
 *     no gh trigger → null · mcp pattern mismatch → null · empty text → null ·
 *     vale broken → null · alerts below levels → null · allowPhrases drop → null ·
 *     errors + block → deny · alerts + warn → additionalContext ·
 *     anchor falls back to recorded projectDir
 */

const SESSION = 'GATE_SESSION';

function lintResponder(alerts) {
  mockSpawnSync.mockImplementation((_cmd, args) => {
    if (args[0] === 'ls-dirs') return { status: 0, stdout: '' };
    const target = args[args.length - 1];
    return { status: alerts.length ? 1 : 0, stdout: JSON.stringify({ [target]: alerts }) };
  });
}

function errorAlert(over = {}) {
  return {
    Check: 'JustSaySo.Buzzwords',
    Severity: 'error',
    Line: 1,
    Span: [4, 11],
    Match: 'synergy',
    Message: "Banned buzzword: 'synergy'.",
    ...over
  };
}

describe('pre-gate.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isPolicyFile', () => {
    let results;

    beforeEach(() => {
      const env = { JUST_SAY_SO_CONFIG: '/pin/global.json', JUST_SAY_SO_FORCE_CONFIG: '/pin/forced.json' };
      results = {
        project: isPolicyFile('/repo/.just-say-so.json', env),
        personal: isPolicyFile('/anywhere/just-say-so.json', env),
        vale: isPolicyFile('/repo/.vale.ini', env),
        valeAlt: isPolicyFile('/repo/_vale.ini', env),
        vocab: isPolicyFile('/repo/styles/config/vocabularies/Team/accept.txt', env),
        strayAccept: isPolicyFile('/repo/data/accept.txt', env),
        global: isPolicyFile('/pin/global.json', env),
        forced: isPolicyFile('/pin/forced.json', env),
        prose: isPolicyFile('/repo/docs/note.md', env)
      };
    });

    it('should recognize every policy surface and nothing else', () => {
      expect(results).toEqual({
        project: true,
        personal: true,
        vale: true,
        valeAlt: true,
        vocab: true,
        strayAccept: false,
        global: true,
        forced: true,
        prose: false
      });
    });
  });

  describe('when an unrelated tool fires', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, tool_name: 'Read', tool_input: {} }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a file tool carries no path', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: {} }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a file tool writes ordinary prose', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'notes.md'), content: 'we leverage synergy' }
        },
        sandbox.env
      );
    });

    it('should stay out of the way — content checks happen after the write', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when a file tool edits the project config', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: { file_path: path.join(sandbox.work, '.just-say-so.json'), old_string: 'a', new_string: 'b' }
        },
        sandbox.env
      );
    });

    it('should ask for confirmation', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: expect.stringContaining('.just-say-so.json')
        }
      });
    });
  });

  describe('when a file tool edits the Vale vocabulary', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: {
            file_path: path.join(sandbox.work, 'styles', 'config', 'vocabularies', 'Team', 'accept.txt'),
            content: 'synergy\n'
          }
        },
        sandbox.env
      );
    });

    it('should ask for confirmation', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('ask');
    });
  });

  describe('when the check is off and a policy file is edited', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, '.vale.ini'), content: '' }
        },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a gh command publishes with alerts in warn mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { addons: ['gh'] } });
      lintResponder([errorAlert()]);
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'gh pr comment 42 --body "pure synergy"' }
        },
        sandbox.env
      );
    });

    it('should warn with the alert detail and a system line', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: expect.stringContaining('gh pr comment')
        },
        systemMessage: expect.stringContaining('1 error(s)')
      });
    });

    it('should lint the fragment under the chat name', () => {
      const lintCall = mockSpawnSync.mock.calls.find((c) => c[1][0] !== 'ls-dirs');
      expect(lintCall[1][2]).toBe('fragment.chat.md');
    });
  });

  describe('when a gh command publishes errors in block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } });
      lintResponder([errorAlert()]);
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'gh issue create --title "synergy now"' }
        },
        sandbox.env
      );
    });

    it('should deny before anything publishes', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('gh issue create');
    });
  });

  describe('when block mode finds only suggestions', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } });
      lintResponder([errorAlert({ Severity: 'suggestion', Match: 'very' })]);
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'gh pr comment 7 --body "very nice"' }
        },
        sandbox.env
      );
    });

    it('should advise instead of denying', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
      expect(output.hookSpecificOutput.additionalContext).toContain('very');
    });
  });

  describe('when the gh addon is not enabled', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command: 'gh pr comment 1 --body "synergy"' } },
        sandbox.env
      );
    });

    it('should return null without linting', () => {
      expect(output).toBeNull();
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  describe('when the Bash command is not a publishing gh command', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { addons: ['gh'] } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command: 'gh pr view 42' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the check is off for a publishing command', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off', addons: ['gh'] } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command: 'gh pr comment 1 --body "synergy"' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a named MCP tool publishes an error', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', mcpTools: ['mcp__confluence__*'] } });
      lintResponder([errorAlert()]);
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'mcp__confluence__create_page',
          tool_input: { title: 'Q3 plan', body: { text: 'pure synergy' } }
        },
        sandbox.env
      );
    });

    it('should deny with the tool name as target', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('mcp__confluence__create_page');
    });
  });

  describe('when an MCP tool matches no configured pattern', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mcpTools: ['mcp__confluence__*'] } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'mcp__jira__create_issue', tool_input: { body: 'synergy' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when a matching MCP tool carries no strings', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mcpTools: ['mcp__confluence__*'] } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'mcp__confluence__ping', tool_input: {} },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when vale is broken or missing', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } });
      mockSpawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command: 'gh pr comment 1 --body "synergy"' } },
        sandbox.env
      );
    });

    it('should stay silent — session-start owns the missing-binary notice', () => {
      expect(output).toBeNull();
    });
  });

  describe('when every alert falls below the configured level floor', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { addons: ['gh'] }, vale: { levels: 'error' } });
      lintResponder([errorAlert({ Severity: 'suggestion', Match: 'very' })]);
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command: 'gh pr comment 1 --body "very nice"' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when an allowed phrase covers the flagged span', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { addons: ['gh'], allowPhrases: ['robust regression'] } });
      const command = 'gh pr comment 1 --body "the robust regression suite"';
      const start = command.indexOf('robust') + 1; // Vale spans are 1-based columns
      lintResponder([errorAlert({ Match: 'robust', Span: [start, start + 5], Line: 1 })]);
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Bash', tool_input: { command } },
        sandbox.env
      );
    });

    it('should drop the alert and return null', () => {
      expect(output).toBeNull();
    });
  });

  describe('when the event cwd has no project config but one was recorded', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      const projectDir = fs.mkdtempSync(path.join(sandbox.work, 'proj-'));
      fs.writeFileSync(
        path.join(projectDir, '.just-say-so.json'),
        JSON.stringify({ bannedCheck: { mode: 'block', addons: ['gh'] } })
      );
      writeSession(SESSION, { projectDir }, sandbox.env);
      lintResponder([errorAlert()]);
      output = run(
        {
          session_id: SESSION,
          cwd: fs.mkdtempSync(path.join(sandbox.work, 'elsewhere-')),
          tool_name: 'Bash',
          tool_input: { command: 'gh pr comment 1 --body "synergy"' }
        },
        sandbox.env
      );
    });

    it('should anchor on the recorded project and honor its block mode', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    });
  });
});
