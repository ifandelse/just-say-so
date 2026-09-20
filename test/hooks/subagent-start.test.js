import { describe, it, expect, beforeEach } from 'vitest';
import { run } from '../../src/lib/hooks/subagent-start.js';
import { makeSandbox } from '../helpers/sandbox.js';

/*
 * Branch map — src/lib/hooks/subagent-start.js
 *   onSubagentStart true (default) → inject
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

    it('should inject the condensed rules', () => {
      expect(output).toEqual({
        hookSpecificOutput: {
          hookEventName: 'SubagentStart',
          additionalContext: expect.stringContaining('## Communication rules — reminder')
        }
      });
    });
  });

  describe('when the switch is off', () => {
    let output;

    beforeEach(() => {
      const sandbox = makeSandbox({ reminder: { onSubagentStart: false } });
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
