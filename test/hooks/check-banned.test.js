import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../../src/lib/hooks/check-banned.js';
import { makeSandbox } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/check-banned.js
 *   mode off → null · tool not listed → null
 *   own-config gate: .just-say-so.json → ask · just-say-so/config.json → ask ·
 *                    unrelated config.json → normal scan · gate skipped when mode off
 *   file_path present: exclude match → null · include set and not matched → null ·
 *                      include set and matched → proceeds
 *   file_path absent → glob checks skipped, target = tool name
 *   extractText: Write · Edit (new_string only) · MultiEdit (joined) · NotebookEdit ·
 *                default → '' → null · empty text → null
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

  describe('when the tool is not in the configured list', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      const event = writeEvent(sandbox, 'notes.md', 'a robust plan');
      output = run({ ...event, tool_name: 'Bash' }, sandbox.env);
    });

    it('should return null', () => {
      expect(output).toBe(null);
    });
  });

  describe('when the model edits the plugin\'s own config files', () => {
    let projectConfig, globalConfig;

    beforeEach(() => {
      const sandbox = makeSandbox();
      projectConfig = run(
        writeEvent(sandbox, '.just-say-so.json', '{"bannedCheck":{"disableWords":["robust"]}}'),
        sandbox.env
      );
      globalConfig = run(
        {
          session_id: SESSION,
          cwd: sandbox.work,
          tool_name: 'Write',
          tool_input: { file_path: path.join(sandbox.work, 'just-say-so', 'config.json'), content: '{}' }
        },
        sandbox.env
      );
    });

    it('should force a confirmation prompt for both, regardless of content', () => {
      const expected = (name) => ({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason:
            `just-say-so: this edits the just-say-so config (${name}). ` +
            'Allow only if you asked for this change.'
        }
      });
      expect({ projectConfig, globalConfig }).toEqual({
        projectConfig: expected('.just-say-so.json'),
        globalConfig: expected('config.json')
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
    let emptyWrite, unknownTool;

    beforeEach(() => {
      const sandbox = makeSandbox({ bannedCheck: { tools: ['Write', 'Task'] } });
      emptyWrite = run(writeEvent(sandbox, 'notes.md', ''), sandbox.env);
      unknownTool = run(
        { session_id: SESSION, cwd: sandbox.work, tool_name: 'Task', tool_input: { prompt: 'robust' } },
        sandbox.env
      );
    });

    it('should return null for empty content and for tools with no known text field', () => {
      expect({ emptyWrite, unknownTool }).toEqual({ emptyWrite: null, unknownTool: null });
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
});
