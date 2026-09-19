#!/usr/bin/env node
// PreToolUse: gate Write/Edit-style tools on the banned-term list.
import { readStdinJson, emit, runHook } from '../lib/io.js';
import { loadConfig } from '../lib/config.js';
import { loadBanned } from '../lib/rules.js';
import { findViolations, formatViolations } from '../lib/matcher.js';
import { matchesAny } from '../lib/glob.js';
import path from 'node:path';

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

runHook(async () => {
  const input = await readStdinJson();
  const config = loadConfig(input.cwd);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return;
  if (!(bc.tools ?? []).includes(input.tool_name)) return;

  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.notebook_path ?? '';
  if (filePath) {
    if (matchesAny(filePath, bc.exclude, input.cwd)) return;
    if ((bc.include ?? []).length > 0 && !matchesAny(filePath, bc.include, input.cwd)) return;
  }

  const text = extractText(input.tool_name, toolInput);
  if (!text) return;

  const { hard, soft } = findViolations(text, loadBanned(config));
  if (hard.length === 0 && soft.length === 0) return;

  const target = filePath ? path.basename(filePath) : input.tool_name;
  const detail = formatViolations(hard, soft);

  if (hard.length > 0 && bc.mode === 'block') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `just-say-so: banned terms in ${target}:\n${detail}\n` +
          'Rewrite the flagged text per the communication rules, then retry the tool call.'
      }
    });
  } else {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          `just-say-so: banned terms in ${target}:\n${detail}\n` +
          'The call was allowed; fix the flagged text per the communication rules.'
      }
    });
  }
});
