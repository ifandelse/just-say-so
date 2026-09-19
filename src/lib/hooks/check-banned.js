// PreToolUse logic: gate Write/Edit-style tools on the banned-term list.
// Returns the hook output object, or null for silence.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { loadBanned } from '../rules.js';
import { findViolations, formatViolations } from '../matcher.js';
import { matchesAny } from '../glob.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ALLOW_CLI = path.join(PKG_ROOT, 'src', 'cli', 'allow.js');

// The plugin's own config files: the project .just-say-so.json and the
// global ~/.config/just-say-so/config.json.
function isOwnConfig(filePath) {
  const base = path.basename(filePath);
  if (base === '.just-say-so.json') return true;
  return base === 'config.json' && path.basename(path.dirname(filePath)) === 'just-say-so';
}

// Only text the model is adding gets checked: for Edit that is new_string,
// so a file that already contains a banned word doesn't block unrelated edits.
function extractText(toolName, toolInput) {
  switch (toolName) {
    case 'Write':
      return toolInput.content ?? '';
    case 'Edit':
      return toolInput.new_string ?? '';
    case 'MultiEdit':
      return (toolInput.edits ?? []).map((e) => e.new_string ?? '').join('\n');
    case 'NotebookEdit':
      return toolInput.new_source ?? '';
    default:
      return '';
  }
}

export function run(input, env = process.env) {
  const config = loadConfig(input.cwd, env);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return null;
  if (!(bc.tools ?? []).includes(input.tool_name)) return null;

  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.notebook_path ?? '';

  // Editing the plugin's own config would let the model exempt itself from
  // the gate, and scanning the edit would deadlock (the config names the
  // banned words). Neither: force an interactive confirmation, before the
  // exclude globs so nothing can route around it.
  if (filePath && isOwnConfig(filePath)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          `just-say-so: this edits the just-say-so config (${path.basename(filePath)}). ` +
          'Allow only if you asked for this change.'
      }
    };
  }

  if (filePath) {
    if (matchesAny(filePath, bc.exclude, input.cwd)) return null;
    if ((bc.include ?? []).length > 0 && !matchesAny(filePath, bc.include, input.cwd)) return null;
  }

  const text = extractText(input.tool_name, toolInput);
  if (!text) return null;

  const { hard, soft } = findViolations(text, loadBanned(config));
  if (hard.length === 0 && soft.length === 0) return null;

  const target = filePath ? path.basename(filePath) : input.tool_name;
  const detail = formatViolations(hard, soft);

  if (hard.length > 0 && bc.mode === 'block') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `just-say-so: banned terms in ${target}:\n${detail}\n` +
          'Rewrite the flagged text per the communication rules, then retry the tool call. ' +
          'If a flagged term is a precise domain term in this project, ask the user — if they agree, run: ' +
          `node "${ALLOW_CLI}" "${hard[0].term}"`
      }
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        `just-say-so: banned terms in ${target}:\n${detail}\n` +
        'The call was allowed; fix the flagged text per the communication rules.'
    }
  };
}
