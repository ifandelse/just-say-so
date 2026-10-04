// PreToolUse logic, two jobs. File tools: a courtesy confirmation before any
// edit to a just-say-so/Vale policy file — visibility, not a security
// boundary. Bash gh commands and user-named MCP tools: the pre-publication
// check — the only moment the text is still private, so block mode denies
// here, before anything goes out. File contents are checked after the write
// instead (see check-vale.js); a fragment lint gives document-level rules
// wrong answers, published text excepted because it has no document.
// Returns the hook output object, or null for silence.
import path from 'node:path';
import { loadConfig, findProjectConfig, globalConfigPath } from '../config.js';
import { loadMessages, fill } from '../rules.js';
import { extractGhTexts, matchesMcpTool, collectStrings } from '../addons.js';
import { readSession } from '../state.js';
import {
  resolveValeConfig,
  lintText,
  applyConfigExemptions,
  severityRank,
  formatAlerts,
  countBySeverity
} from '../vale.js';

const FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const VALE_CONFIG_NAMES = ['.vale.ini', '_vale.ini', 'vale.ini'];

// The policy surface: the plugin's config files, Vale configs, and the
// vocabulary accept list — the model's cheapest path around a block is a
// quiet edit to one of these, so each gets a confirmation prompt.
export function isPolicyFile(filePath, env) {
  const base = path.basename(filePath);
  if (base === '.just-say-so.json' || base === 'just-say-so.json') return true;
  if (VALE_CONFIG_NAMES.includes(base)) return true;
  if (base === 'accept.txt' && filePath.split(path.sep).includes('vocabularies')) return true;
  const resolved = path.resolve(filePath);
  if (resolved === path.resolve(globalConfigPath(env))) return true;
  return Boolean(env.JUST_SAY_SO_FORCE_CONFIG) && resolved === path.resolve(env.JUST_SAY_SO_FORCE_CONFIG);
}

// Bash and MCP events carry no file path to anchor config discovery on, and
// their cwd can point outside the project (seen live on subagent events).
// Fall back to the project directory the prompt hook recorded.
function commandAnchor(input, env) {
  if (findProjectConfig(input.cwd)) return input.cwd;
  const recorded = readSession(input.session_id ?? 'unknown', env).projectDir;
  if (recorded && findProjectConfig(recorded)) return recorded;
  return input.cwd;
}

function countsLine(messages, alerts) {
  const c = countBySeverity(alerts);
  return fill(messages.valeCounts, { errors: c.error, warnings: c.warning, suggestions: c.suggestion });
}

// A value the extractor refused to guess at needs an answer. The config
// decides ("ask" is the default). When the harness mode already answers
// permission questions automatically, an "ask" has nobody to answer it —
// a `claude -p` run denies it outright — so the configured "ask" becomes
// "allow", and the warning note stays visible in the hook output.
const AUTO_PERMISSION_MODES = ['bypassPermissions', 'dontAsk', 'auto'];

function unresolvedPolicy(bc, input) {
  const configured = bc.unresolved ?? 'ask';
  if (configured !== 'ask') return configured;
  return AUTO_PERMISSION_MODES.includes(input.permission_mode) ? 'allow' : 'ask';
}

// gh commands and MCP tools publish text humans read. The check lints the
// extracted payloads, never the raw command: flags and paths are shell
// syntax, and a punctuation rule reads `--body` as prose and false-denies.
// Each payload lints alone under the `*.chat.md` name, selecting the
// reduced chat section of the config, so document-level rules stay out of
// a fragment's way and line numbers match the payload.
function runPublishCheck(toolName, toolInput, input, env) {
  const anchor = commandAnchor(input, env);
  const config = loadConfig(anchor, env);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return null;

  let payloads, unresolved, target;
  if (toolName === 'Bash') {
    if (!(bc.addons ?? []).includes('gh')) return null;
    const extracted = extractGhTexts(toolInput.command);
    if (!extracted) return null;
    ({ payloads, unresolved, target } = extracted);
  } else {
    if (!matchesMcpTool(toolName, bc.mcpTools)) return null;
    const text = collectStrings(toolInput).join('\n');
    payloads = text ? [{ label: toolName, text }] : [];
    unresolved = [];
    target = toolName;
  }
  if (payloads.length === 0 && unresolved.length === 0) return null;

  const configPath = resolveValeConfig(anchor, config);
  const visible = [];
  for (const payload of payloads) {
    const raw = lintText(payload.text, { name: 'fragment.chat.md', configPath, env });
    if (raw === null) return null; // vale missing or broken: silent, session-start told the user
    const lines = payload.text.split('\n');
    const alerts = applyConfigExemptions(raw, bc, (_file, line) => lines[line - 1] ?? null);
    for (const a of alerts) {
      if (severityRank(a.Severity) <= severityRank(config.vale.levels)) {
        visible.push({ ...a, file: payload.label });
      }
    }
  }

  const messages = loadMessages(config);
  const intro = fill(messages.publishIntro, { target });
  const detail = formatAlerts(visible, { truncatedNote: messages.valeTruncated, withFile: true });
  const constructs = unresolved.map((u) => `${u.label} (${u.reason})`).join(', ');
  const unresolvedNote = unresolved.length > 0 ? fill(messages.publishUnresolvedNote, { constructs }) : '';
  const hasErrors = visible.some((a) => a.Severity === 'error');

  if (bc.mode === 'block' && hasErrors) {
    const parts = [intro, detail, `${messages.rewriteInstruction} ${messages.escapeHatch}`];
    if (unresolvedNote) parts.push(unresolvedNote);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: parts.join('\n')
      }
    };
  }

  if (bc.mode === 'block' && unresolved.length > 0) {
    const policy = unresolvedPolicy(bc, input);
    if (policy === 'deny') {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: fill(messages.publishUnresolvedDeny, { target, constructs })
        }
      };
    }
    if (policy === 'ask') {
      const parts = [fill(messages.publishUnresolvedAsk, { target, constructs })];
      if (visible.length > 0) parts.push(intro, detail);
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
          permissionDecisionReason: parts.join('\n')
        }
      };
    }
    // policy "allow" falls through to the advisory output below
  }

  if (visible.length === 0 && unresolved.length === 0) return null;

  const parts = [];
  if (visible.length > 0) parts.push(intro, detail);
  if (unresolvedNote) parts.push(unresolvedNote);
  parts.push(messages.warnInstruction);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: parts.join('\n')
    },
    systemMessage: fill(messages.valeSystemLine, { counts: countsLine(messages, visible), target })
  };
}

export function run(input, env = process.env) {
  const toolName = String(input.tool_name ?? '');
  const toolInput = input.tool_input ?? {};

  if (toolName === 'Bash' || toolName.startsWith('mcp__')) {
    return runPublishCheck(toolName, toolInput, input, env);
  }
  if (!FILE_TOOLS.includes(toolName)) return null;

  const filePath = toolInput.file_path ?? toolInput.notebook_path ?? '';
  if (!filePath || !isPolicyFile(filePath, env)) return null;

  const config = loadConfig(path.dirname(filePath), env);
  if (config.bannedCheck.mode === 'off') return null;

  const messages = loadMessages(config);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: fill(messages.configAskReason, { target: path.basename(filePath) })
    }
  };
}
