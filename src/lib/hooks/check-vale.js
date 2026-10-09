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
  alertKey,
  resolveValeConfig,
  lintPath,
  applyConfigExemptions,
  fileLineReader,
  severityRank,
  formatAlerts,
  countBySeverity
} from '../vale.js';

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function countsLine(messages, alerts) {
  const c = countBySeverity(alerts);
  return fill(messages.valeCounts, { errors: c.error, warnings: c.warning, suggestions: c.suggestion });
}

// Record this file's outstanding error alerts for the Stop gate: every
// error in the lines this edit added, plus every instance an earlier edit
// recorded that the whole-file lint still finds. The merge is what keeps a
// later clean edit to the same file from wiping an earlier edit's unfixed
// error. Prior instances match by key with a budget, as the gate does, so
// pre-existing dirt outside the edit never enters the record. An in-range
// instance spends budget too, so a re-added instance (a Write that keeps
// the line) counts once and no twin elsewhere inherits its slot.
function recordErrors(sessionId, file, fileErrors, ranges, env) {
  const state = readSession(sessionId, env);
  const prior = state.valeFiles?.[file]?.outstanding ?? [];
  const budget = new Map();
  for (const o of prior) budget.set(o.key, (budget.get(o.key) ?? 0) + 1);

  const outstanding = [];
  for (const a of fileErrors) {
    const key = alertKey(a);
    const left = budget.get(key) ?? 0;
    const added = inRanges(a.Line, ranges);
    if (!added && left === 0) continue;
    outstanding.push({ key, line: a.Line });
    if (left > 0) budget.set(key, left - 1);
  }

  if (outstanding.length === 0 && prior.length === 0) return;
  state.valeFiles = { ...(state.valeFiles ?? {}) };
  if (outstanding.length === 0) delete state.valeFiles[file];
  else state.valeFiles[file] = { outstanding };
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

  const fileErrors = applyConfigExemptions(
    raw.filter((a) => a.Severity === 'error'),
    bc,
    fileLineReader()
  );
  recordErrors(input.session_id ?? 'unknown', abs, fileErrors, ranges, env);

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
