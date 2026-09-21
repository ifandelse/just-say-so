// PreToolUse logic: gate Write/Edit-style tools on the banned-term list.
// Returns the hook output object, or null for silence.
import path from 'node:path';
import { loadConfig, findProjectConfig } from '../config.js';
import { loadBanned, loadMessages, fill } from '../rules.js';
import { findViolations, formatViolations } from '../matcher.js';
import { matchesAny } from '../glob.js';

// The plugin's own config files: the project .just-say-so.json and the
// global ~/.config/just-say-so/config.json.
function isOwnConfig(filePath) {
  const base = path.basename(filePath);
  if (base === '.just-say-so.json') return true;
  return base === 'config.json' && path.basename(path.dirname(filePath)) === 'just-say-so';
}

function isWordChar(ch) {
  return ch !== undefined && /[\w-]/.test(ch);
}

// The text an Edit actually adds: strip the longest common prefix and suffix
// shared with old_string, then widen each cut to a word boundary so a term
// completed by the edit ("ro" -> "robust") still scans whole. Models edit by
// anchor-replacement, which copies untouched old text into new_string —
// scanning all of new_string flags text this edit never wrote. A multiword
// phrase straddling a cut at whitespace can slip through; accepted edge.
function addedText(oldString, newString) {
  const a = String(oldString ?? '');
  const b = String(newString ?? '');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  while (start > 0 && isWordChar(b[start - 1]) && isWordChar(b[start])) start--;
  while (endB < b.length && isWordChar(b[endB - 1]) && isWordChar(b[endB])) endB++;
  return b.slice(start, endB);
}

// Only text the model is adding gets checked.
function extractText(toolName, toolInput) {
  switch (toolName) {
    case 'Write':
      return toolInput.content ?? '';
    case 'Edit':
      return addedText(toolInput.old_string, toolInput.new_string);
    case 'MultiEdit':
      return (toolInput.edits ?? []).map((e) => addedText(e.old_string, e.new_string)).join('\n');
    case 'NotebookEdit':
      return toolInput.new_source ?? '';
    default:
      return '';
  }
}

export function run(input, env = process.env) {
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.notebook_path ?? '';

  // Anchor config discovery on the file being written, not the event's cwd:
  // subagent and Stop events can carry a cwd outside the project (seen live),
  // and the target file's project is the semantically right one anyway.
  const anchor = filePath ? path.dirname(filePath) : input.cwd;
  const config = loadConfig(anchor, env);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return null;
  if (!(bc.tools ?? []).includes(input.tool_name)) return null;

  // The config file names the banned words, so scanning it would deadlock;
  // and a config change deserves a look before it lands. A courtesy
  // confirmation covers both — this is visibility, not a security boundary.
  if (filePath && isOwnConfig(filePath)) {
    const messages = loadMessages(config);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: fill(messages.configAskReason, { target: path.basename(filePath) })
      }
    };
  }

  if (filePath) {
    // Relative glob patterns measure from the project root (the directory
    // holding the config file), so "docs/**" works from any subdirectory.
    const projectFile = findProjectConfig(anchor);
    const globBase = projectFile ? path.dirname(projectFile) : input.cwd;
    if (matchesAny(filePath, bc.exclude, globBase)) return null;
    if ((bc.include ?? []).length > 0 && !matchesAny(filePath, bc.include, globBase)) return null;
  }

  const text = extractText(input.tool_name, toolInput);
  if (!text) return null;

  const { hard, soft } = findViolations(text, loadBanned(config));
  if (hard.length === 0 && soft.length === 0) return null;

  const messages = loadMessages(config);
  const target = filePath ? path.basename(filePath) : input.tool_name;
  const intro = fill(messages.bannedIntro, { target });
  const detail = formatViolations(hard, soft, messages.advisoryLabel);

  if (hard.length > 0 && bc.mode === 'block') {
    // The model picks the collocation — it wrote the text and can see whether
    // the flagged word sits inside a domain term. The hook can't.
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `${intro}\n${detail}\n${messages.rewriteInstruction} ${messages.escapeHatch}`
      }
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `${intro}\n${detail}\n${messages.warnInstruction}`
    }
  };
}
