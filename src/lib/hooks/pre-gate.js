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
import { matchGhTrigger, matchesMcpTool, collectStrings } from '../addons.js';
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

// gh commands and MCP tools publish text humans read. The fragment lints
// under the `*.chat.md` name, selecting the reduced chat section of the
// config, so document-level rules stay out of a fragment's way.
function runPublishCheck(toolName, toolInput, input, env) {
  const anchor = commandAnchor(input, env);
  const config = loadConfig(anchor, env);
  const bc = config.bannedCheck;
  if (bc.mode === 'off') return null;

  let text, target;
  if (toolName === 'Bash') {
    if (!(bc.addons ?? []).includes('gh')) return null;
    target = matchGhTrigger(toolInput.command);
    if (!target) return null;
    text = String(toolInput.command);
  } else {
    if (!matchesMcpTool(toolName, bc.mcpTools)) return null;
    text = collectStrings(toolInput).join('\n');
    target = toolName;
  }
  if (!text) return null;

  const configPath = resolveValeConfig(anchor, config);
  const raw = lintText(text, { name: 'fragment.chat.md', configPath, env });
  if (raw === null) return null; // vale missing or broken: silent, session-start told the user

  const lines = text.split('\n');
  const alerts = applyConfigExemptions(raw, bc, (_file, line) => lines[line - 1] ?? null);
  const visible = alerts.filter((a) => severityRank(a.Severity) <= severityRank(config.vale.levels));
  if (visible.length === 0) return null;

  const messages = loadMessages(config);
  const intro = fill(messages.publishIntro, { target });
  const detail = formatAlerts(visible, { truncatedNote: messages.valeTruncated });
  const hasErrors = visible.some((a) => a.Severity === 'error');

  if (hasErrors && bc.mode === 'block') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `${intro}\n${detail}\n${messages.rewriteInstruction} ${messages.escapeHatch}`
      }
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `${intro}\n${detail}\n${messages.warnInstruction}`
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
