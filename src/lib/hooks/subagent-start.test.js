import { describe, it, expect, beforeEach } from 'vitest';
import { run } from './subagent-start.js';
import { makeSandbox } from '../../../test/helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/subagent-start.js
 *   onSubagentStart true (default) → inject the full text
 *   rules.contextStartText condensed → inject the reminder
 *   onSubagentStart false → null
 */

describe('subagent-start.run', () => {
  describe('when a subagent spawns with the default config', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox();
      output = run(
        { session_id: 'MAIN_SESSION', agent_id: 'AGENT_8675309', agent_type: 'Explore', cwd: sandbox.work },
        sandbox.env
      );
    });

    it('should inject the full rules', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: expect.stringMatching(/^## Communication rules\n[^]*### Precision first/)
        }
      });
    });
  });

  describe('when the config asks for the condensed text', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ rules: { contextStartText: 'condensed' } });
      output = run({ session_id: 'MAIN_SESSION', agent_id: 'AGENT_1', agent_type: 'Explore', cwd: sandbox.work }, sandbox.env);
    });

    it('should inject the reminder', () => {
      expect(output.hookSpecificOutput.additionalContext).toMatch(/^## Communication rules — reminder\n/);
    });
  });

  describe('when the switch is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ rules: { onSubagentStart: false } });
      output = run(
        { session_id: 'MAIN_SESSION', agent_id: 'AGENT_8675309', agent_type: 'Explore', cwd: sandbox.work },
        sandbox.env
      );
    });

    it('should stay silent', () => {
      expect(output).toBe(null);
    });
  });
});
