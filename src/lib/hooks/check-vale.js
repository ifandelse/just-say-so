// PostToolUse logic: run Vale on the file a tool just wrote, keep the
// alerts that fall in lines this edit added, and hand the model the facts.
// This hook never blocks — the tool already ran — and per-write errors are
// recorded in session state so the Stop gate can hold the model to exactly
// what it wrote this session, and nothing else.
// Returns the hook output object, or null for silence.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { loadMessages, fill } from '../rules.js';
import { readSession, writeSession } from '../state.js';
import { addedRanges, inRanges } from '../edit-ranges.js';
import { isPolicyFile } from './pre-gate.js';
import {
  resolveValeConfig,
  lintPath,
  applyConfigExemptions,
  fileLineReader,
  severityRank,
  formatAlerts,
  countBySeverity
} from '../vale.js';

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

export function alertKey(a) {
  return `${a.Check}|${String(a.Match).toLowerCase()}`;
}

function countsLine(messages, alerts) {
  const c = countBySeverity(alerts);
  return fill(messages.valeCounts, { errors: c.error, warnings: c.warning, suggestions: c.suggestion });
}

// Record this file's outstanding error alerts, replacing whatever an
// earlier edit recorded — the newest lint of a file is the truth about it.
function recordErrors(sessionId, file, errors, env) {
  const state = readSession(sessionId, env);
  const had = Boolean(state.valeFiles?.[file]);
  if (errors.length === 0 && !had) return;
  state.valeFiles = { ...(state.valeFiles ?? {}) };
  if (errors.length === 0) delete state.valeFiles[file];
  else state.valeFiles[file] = { outstanding: errors.map((a) => ({ key: alertKey(a), line: a.Line })) };
  writeSession(sessionId, state, env);
}

export function run(input, env = process.env) {
  const toolName = String(input.tool_name ?? '');
  if (!FILE_TOOLS.includes(toolName)) return null;

  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path ?? toolInput.notebook_path ?? '';
  if (!filePath) return null;

  const abs = path.resolve(input.cwd ?? '.', filePath);
  // Policy files get their confirmation before the write; linting them
  // after it would only report the banned words they exist to name.
  if (isPolicyFile(abs, env)) return null;

  // Anchor config discovery on the file being written, not the event's cwd
  // (subagent events can carry a cwd outside the project — seen live).
  const config = loadConfig(path.dirname(abs), env);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return null;

  const configPath = resolveValeConfig(path.dirname(abs), config);
  const raw = lintPath(abs, { configPath, env });
  if (raw === null) return null; // vale missing or broken: silent, session-start told the user

  let content = null;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    // unreadable after a successful lint is unexpected; fall back to whole file
  }
  const ranges = content === null ? null : addedRanges(toolName, toolInput, content);
  const scoped = raw.filter((a) => inRanges(a.Line, ranges));
  const alerts = applyConfigExemptions(scoped, bc, fileLineReader());
  const errors = alerts.filter((a) => a.Severity === 'error');

  recordErrors(input.session_id ?? 'unknown', abs, errors, env);

  const visible = alerts.filter((a) => severityRank(a.Severity) <= severityRank(config.vale.levels));
  if (visible.length === 0) return null;

  const messages = loadMessages(config);
  const target = path.basename(abs);
  const counts = countsLine(messages, visible);
  const intro = fill(ranges === null ? messages.valeWholeFileIntro : messages.valeEditIntro, {
    counts,
    target
  });
  const detail = formatAlerts(visible, { truncatedNote: messages.valeTruncated });

  return {
    systemMessage: fill(messages.valeSystemLine, { counts, target }),
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `${intro}\n${detail}\n${messages.valeFixInstruction}`
    }
  };
}
