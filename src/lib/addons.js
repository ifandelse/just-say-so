import { globToRegExp } from './glob.js';

// The gh commands that publish prose for humans to read. Triggering keys on
// the subcommand pair alone: a triggered command with no prose scans clean
// and costs nothing, while gating on a body flag would miss prose in other
// flags (a --title, for example). `gh api` is deliberately out of scope.
const GH_TRIGGER = /\bgh\s+(pr|issue|release)\s+(create|comment|edit|review)\b/;

export function matchGhTrigger(command) {
  const m = GH_TRIGGER.exec(String(command ?? ''));
  return m ? `gh ${m[1]} ${m[2]}` : null;
}

// MCP tool names are not standardized across servers, so coverage is
// user-named patterns ("mcp__confluence__*"). Tool names contain no slashes,
// so a * wildcard spans the whole name.
export function matchesMcpTool(toolName, patterns) {
  return (patterns ?? []).some((p) => globToRegExp(p).test(String(toolName)));
}

// Every string value in a tool input, nested fields included. The checker
// scans the whole pile: naming a target is easy to get right, while naming
// the prose-bearing fields per tool invites silent misses.
export function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}
