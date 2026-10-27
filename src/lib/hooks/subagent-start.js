// SubagentStart logic: a subagent starts with fresh context, so the rules
// injected into the main session don't exist for it. Brief it at spawn.
// Returns the hook output object, or null when the switch is off.
import { loadConfig } from '../config.js';
import { contextRules } from '../rule-state.js';

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  if (!config.rules.onSubagentStart) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: contextRules(config, input.cwd, env)
    }
  };
}
