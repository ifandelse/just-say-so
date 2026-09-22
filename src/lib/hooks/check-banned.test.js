import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { run } from './check-banned.js';
import { writeSession } from '../state.js';
import { makeSandbox } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-banned.js
 *   mode off → null (file path and command path) · uncovered tool → null
 *   own-config gate: .just-say-so.json → ask · just-say-so.json → ask ·
 *                    the JUST_SAY_SO_CONFIG target → ask ·
 *                    the JUST_SAY_SO_FORCE_CONFIG target → ask ·
 *                    unrelated config.json → normal scan · gate skipped when mode off
 *   file_path present: exclude match → null · include set and not matched → null ·
 *                      include set and matched → proceeds
 *   file_path absent → glob checks skipped, target = tool name
 *   config anchoring: file's own directory finds the project config even when
 *                     the event's cwd points elsewhere · relative globs measure
 *                     from the config file's directory
 *   Bash: gh addon off → null · no publishing trigger → null · trigger + hard →
 *         verdict with the matched phrase as target
 *   MCP: no pattern match → null · pattern match + hard → verdict with the tool
 *        name as target · all-non-string input → null
 *   command anchoring: event cwd finds no project config → recorded projectDir ·
 *                      nothing recorded → defaults apply
 *   extractText: Write · Edit (diff of old/new: copied anchor text skipped,
 *                straddled word widened to boundary) · MultiEdit (joined) ·
 *                NotebookEdit · empty text → null
 *   violations: none → null · hard + default (warn) → additionalContext ·
 *               hard + block → deny with allow-skill suggestion ·
 *               soft-only + block → additionalContext ·
 *               allowPhrases: match inside collocation → null, outside → flagged
 */

const SESSION = 'BANNED_SESSION';

function writeEvent(sandbox, file, content, extra = {}) {
  return {
    session_id: SESSION,
    cwd: sandbox.work,
    tool_name: 'Write',
    tool_input: { file_path: path.join(sandbox.work, file), content },
    ...extra
  };
}

describe('check-banned.run', () => {
  describe('when the check is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' } });
      output = run(writeEvent(sandbox, 'notes.md', 'a robust plan'), sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when a tool the checker does not cover fires', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Grep', tool_input: { pattern: 'robust' } },
        sandbox.env
      );
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the model edits the plugin\'s own config files', () => {
    let projectConfig, personalConfig, envConfig, forcedConfig;

    beforeEach(() => {
      const sandbox = makeSandbox();
      projectConfig = run(
        writeEvent(sandbox, '.just-say-so.json', '{"bannedCheck":{"disableWords":["robust"]}}'),
        sandbox.env
      );
      personalConfig = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'anywhere', 'just-say-so.json'), content: '{}' }
        },
        sandbox.env
      );
      // the sandbox configFile has a name the basename check never matches —
      // only the JUST_SAY_SO_CONFIG path comparison can gate it
      envConfig = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: sandbox.configFile, content: '{}' }
        },
        sandbox.env
      );
      forcedConfig = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'ci.json'), content: '{}' }
        },
        { ...sandbox.env, JUST_SAY_SO_FORCE_CONFIG: path.join(sandbox.work, 'ci.json') }
      );
    });

    it('should force a confirmation prompt for all four, regardless of content', () => {
      const expected = (name) => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason:
            `just-say-so: this edits the just-say-so config (${name}). ` +
            'Allow only if you asked for this change.'
        }
      });
      expect({ projectConfig, personalConfig, envConfig, forcedConfig }).toEqual({
        projectConfig: expected('.just-say-so.json'),
        personalConfig: expected('just-say-so.json'),
        envConfig: expected('config.json'),
        forcedConfig: expected('ci.json')
      });
    });
  });

  describe('when an unrelated config.json is edited', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(writeEvent(sandbox, 'app/config.json', '{"retries": 3}'), sandbox.env);
    });

    it('should scan it normally instead of gating', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the check is off and the own config is edited', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'off' } });
      output = run(writeEvent(sandbox, '.just-say-so.json', '{}'), sandbox.env);
    });

    it('should not gate — the user opted out of enforcement', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the file matches a default exclude glob', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(writeEvent(sandbox, 'package.json', '"robust": "a banned word"'), sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when an include list is set and the file falls outside it', () => {
    let excluded, included;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { include: ['docs/**'] } });
      excluded = run(writeEvent(sandbox, 'src/notes.md', 'a robust plan'), sandbox.env);
      included = run(writeEvent(sandbox, 'docs/notes.md', 'a robust plan'), sandbox.env);
    });

    it('should check only files inside the include list', () => {
      expect({ excludedIsNull: excluded === null, includedDenies: included !== null }).toEqual({
        excludedIsNull: true,
        includedDenies: true
      });
    });
  });

  describe('when the tool input carries no text', () => {
    let emptyWrite;

    beforeEach(() => {
      const sandbox = makeSandbox();
      emptyWrite = run(writeEvent(sandbox, 'notes.md', ''), sandbox.env);
    });

    it('should return null for empty content', () => {
      expect(emptyWrite).toBe(null);
    });
  });

  describe('when the event carries no tool_input at all', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run({ session_id: SESSION, cwd: sandbox.work, tool_name: 'Write' }, sandbox.env);
    });

    it('should return null instead of throwing', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the content is clean', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(writeEvent(sandbox, 'notes.md', 'The scheduler retries the job.'), sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when a Write has hard violations in block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(writeEvent(sandbox, 'notes.md', 'We leverage robust solutions in order to ship.'), sandbox.env);
    });

    it('should deny with the violation list and the allow-skill suggestion', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'just-say-so: banned terms in notes.md:\n' +
            '  - "leverage" ×1 — use a concrete verb: use, apply, rely on\n' +
            '  - "robust" ×1\n' +
            '  - "in order to" ×1 — use "to"\n' +
            'Rewrite the flagged text per the communication rules, then retry the tool call. ' +
            'If a flagged term is a precise domain term in this project, suggest that the user run: ' +
            '/just-say-so:allow "<collocation>" — quote the flagged term as it appears in the text ' +
            '(for example "robust regression", not "robust").'
        }
      });
    });
  });

  describe('when the event cwd points outside the project', () => {
    let denied, excluded;

    beforeEach(() => {
      const sandbox = makeSandbox();
      fs.writeFileSync(
        path.join(sandbox.work, '.just-say-so.json'),
        JSON.stringify({ bannedCheck: { mode: 'block', exclude: ['docs/**'] } })
      );
      fs.mkdirSync(path.join(sandbox.work, 'docs'), { recursive: true });
      const base = (file) => ({
        session_id: SESSION,
        cwd: '/nope/elsewhere', // a subagent's cwd, seen live
        tool_name: 'Write',
        tool_input: { file_path: path.join(sandbox.work, file), content: 'a robust plan' }
      });
      denied = run(base('notes.md'), sandbox.env);
      excluded = run(base('docs/notes.md'), sandbox.env);
    });

    it('should find the project config from the file path and measure globs from the project root', () => {
      expect({
        deniedDecision: denied?.hookSpecificOutput.permissionDecision,
        excludedIsNull: excluded === null
      }).toEqual({ deniedDecision: 'deny', excludedIsNull: true });
    });
  });

  describe('when an Edit appends clean text anchored on a banned line', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: {
            file_path: path.join(sandbox.work, 'notes.md'),
            old_string: 'We leverage robust synergy to streamline everything.',
            new_string: 'We leverage robust synergy to streamline everything.\nThe tests pass.'
          }
        },
        sandbox.env
      );
    });

    it('should scan only the appended text and stay silent', () => {
      expect(output).toBe(null);
    });
  });

  describe('when an Edit completes a banned word across the cut', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: {
            file_path: path.join(sandbox.work, 'notes.md'),
            old_string: 'a ro plan',
            new_string: 'a robust plan'
          }
        },
        sandbox.env
      );
    });

    it('should widen to the word boundary and still flag it', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('"robust" ×1');
    });
  });

  describe('when an Edit replaces banned text with clean text', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Edit',
          tool_input: {
            file_path: path.join(sandbox.work, 'notes.md'),
            old_string: 'our robust, seamless platform',
            new_string: 'our platform'
          }
        },
        sandbox.env
      );
    });

    it('should check only the new text and stay silent', () => {
      expect(output).toBe(null);
    });
  });

  describe('when a MultiEdit adds banned text in one of its edits', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'MultiEdit',
          tool_input: {
            file_path: path.join(sandbox.work, 'notes.md'),
            edits: [{ new_string: 'clean text' }, { new_string: 'a seamless launch' }]
          }
        },
        sandbox.env
      );
    });

    it('should deny on the joined edit text', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('"seamless" ×1');
    });
  });

  describe('when a NotebookEdit has banned text and no file_path field', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'NotebookEdit',
          tool_input: { notebook_path: path.join(sandbox.work, 'analysis.ipynb'), new_source: 'we empower users' }
        },
        sandbox.env
      );
    });

    it('should extract new_source and name the notebook in the reason', () => {
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
        'just-say-so: banned terms in analysis.ipynb'
      );
    });
  });

  describe('when no path fields exist at all', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Write', tool_input: { content: 'pure synergy' } },
        sandbox.env
      );
    });

    it('should skip glob checks and name the tool as the target', () => {
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('just-say-so: banned terms in Write');
    });
  });

  describe('when a project allows a domain collocation', () => {
    let insideAllowed, outsideAllowed;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', allowPhrases: ['robust regression'] } });
      insideAllowed = run(writeEvent(sandbox, 'stats.md', 'We fit a robust regression model.'), sandbox.env);
      outsideAllowed = run(writeEvent(sandbox, 'stats.md', 'We built a robust pipeline.'), sandbox.env);
    });

    it('should pass the collocation and still block the bare term', () => {
      expect({
        insideAllowedIsNull: insideAllowed === null,
        outsideAllowedDenies: outsideAllowed?.hookSpecificOutput.permissionDecision === 'deny'
      }).toEqual({ insideAllowedIsNull: true, outsideAllowedDenies: true });
    });
  });

  describe('when the default (warn) mode finds hard violations', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(writeEvent(sandbox, 'notes.md', 'a seamless experience'), sandbox.env);
    });

    it('should allow the call and inject feedback instead', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'just-say-so: banned terms in notes.md:\n' +
            '  - "seamless" ×1\n' +
            'The call was allowed; fix the flagged text per the communication rules.'
        }
      });
    });
  });

  describe('when a message catalog override is configured', () => {
    let output;

    beforeEach(() => {
      const catalogDir = makeSandbox().work;
      const catalog = path.join(catalogDir, 'CAL_ZONE_VOICE.json');
      fs.writeFileSync(catalog, JSON.stringify({ bannedIntro: 'palabras prohibidas en {target}:' }));
      const sandbox = makeSandbox({ rules: { messagesPath: catalog }, bannedCheck: { mode: 'block' } });
      output = run(writeEvent(sandbox, 'notes.md', 'pure synergy'), sandbox.env);
    });

    it('should use the overridden strings and keep shipped ones for unlisted keys', () => {
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      expect(reason.startsWith('palabras prohibidas en notes.md:')).toBe(true);
      expect(reason).toContain('Rewrite the flagged text per the communication rules');
    });
  });

  describe('when block mode finds only advisories', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block' } });
      output = run(writeEvent(sandbox, 'notes.md', 'This is very nice.'), sandbox.env);
    });

    it('should inject the advisory without denying', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'just-say-so: banned terms in notes.md:\n' +
            '  - advisories (replace with a measurement or a concrete consequence): "very" ×1\n' +
            'The call was allowed; fix the flagged text per the communication rules.'
        }
      });
    });
  });

  describe('when a gh publishing command has violations and the addon is on', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { addons: ['gh'] } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'gh pr comment 42 --body "a robust plan"' }
        },
        sandbox.env
      );
    });

    it('should warn with the matched phrase as the target', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'just-say-so: banned terms in gh pr comment:\n' +
            '  - "robust" ×1\n' +
            'The call was allowed; fix the flagged text per the communication rules.'
        }
      });
    });
  });

  describe('when a gh command inside a compound command hits block mode', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { mode: 'block', addons: ['gh'] } });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Bash',
          tool_input: { command: 'git add . && gh pr create --title "Robust improvements"' }
        },
        sandbox.env
      );
    });

    it('should deny before the command publishes anything', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
        'just-say-so: banned terms in gh pr create:'
      );
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('"robust" ×1');
    });
  });

  describe('when Bash commands miss the gate conditions', () => {
    let addonOff, noTrigger, modeOff;

    beforeEach(() => {
      const bare = makeSandbox();
      const withAddon = makeSandbox({ bannedCheck: { addons: ['gh'] } });
      const off = makeSandbox({ bannedCheck: { mode: 'off', addons: ['gh'] } });
      const event = (sandbox, command) => ({
        session_id: SESSION,
        cwd: sandbox.work,
        tool_name: 'Bash',
        tool_input: { command }
      });
      addonOff = run(event(bare, 'gh pr comment 42 --body "a robust plan"'), bare.env);
      noTrigger = run(event(withAddon, 'gh pr view 42 --json body'), withAddon.env);
      modeOff = run(event(off, 'gh pr comment 42 --body "a robust plan"'), off.env);
    });

    it('should return null when the addon is off, the command does not publish, or the mode is off', () => {
      expect({ addonOff, noTrigger, modeOff }).toEqual({ addonOff: null, noTrigger: null, modeOff: null });
    });
  });

  describe('when the Bash event cwd points outside the project', () => {
    let withRecorded, withoutRecorded;

    beforeEach(() => {
      const sandbox = makeSandbox();
      fs.writeFileSync(
        path.join(sandbox.work, '.just-say-so.json'),
        JSON.stringify({ bannedCheck: { mode: 'block', addons: ['gh'] } })
      );
      const event = {
        session_id: SESSION,
        cwd: '/nope/elsewhere', // a subagent's cwd, seen live
        tool_name: 'Bash',
        tool_input: { command: 'gh pr comment 42 --body "a robust plan"' }
      };
      writeSession(SESSION, { projectDir: sandbox.work }, sandbox.env);
      withRecorded = run(event, sandbox.env);

      const bare = makeSandbox();
      withoutRecorded = run(event, bare.env);
    });

    it('should fall back to the recorded project directory, and to defaults without one', () => {
      expect({
        withRecordedDecision: withRecorded?.hookSpecificOutput.permissionDecision,
        withoutRecorded
      }).toEqual({ withRecordedDecision: 'deny', withoutRecorded: null });
    });
  });

  describe('when a named MCP tool sends violations in a nested field', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({
        bannedCheck: { mode: 'block', mcpTools: ['mcp__confluence__*'] }
      });
      output = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'mcp__confluence__createPage',
          tool_input: { space: 'ENG', page: { title: 'Notes', body: 'a robust plan' } }
        },
        sandbox.env
      );
    });

    it('should deny with the tool name as the target', () => {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
        'just-say-so: banned terms in mcp__confluence__createPage:'
      );
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('"robust" ×1');
    });
  });

  describe('when MCP calls miss the gate conditions', () => {
    let unlisted, noPatterns, noStrings;

    beforeEach(() => {
      const withPatterns = makeSandbox({ bannedCheck: { mcpTools: ['mcp__confluence__*'] } });
      const bare = makeSandbox();
      const event = (sandbox, toolName, toolInput) => ({
        session_id: SESSION,
        cwd: sandbox.work,
        tool_name: toolName,
        tool_input: toolInput
      });
      unlisted = run(
        event(withPatterns, 'mcp__slack__postMessage', { text: 'a robust plan' }),
        withPatterns.env
      );
      noPatterns = run(
        event(bare, 'mcp__confluence__createPage', { body: 'a robust plan' }),
        bare.env
      );
      noStrings = run(event(withPatterns, 'mcp__confluence__createPage', { count: 3 }), withPatterns.env);
    });

    it('should return null for unlisted tools, empty patterns, and string-free input', () => {
      expect({ unlisted, noPatterns, noStrings }).toEqual({
        unlisted: null,
        noPatterns: null,
        noStrings: null
      });
    });
  });
});
