import fs from 'node:fs';
import { globToRegExp } from './glob.js';

// The gh commands that publish prose for humans to read. The check lints the
// extracted text payloads, never the command string itself: flags and paths
// are shell syntax, and a punctuation rule like DoubleHyphen reads `--body`
// as prose and false-denies the call (seen live under a repo config that
// loads ai-tells). `gh api` is covered when it writes a prose field.
const GH_TRIGGER = /\bgh\s+(pr|issue|release)\s+(create|comment|edit|review)\b/;

export function matchGhTrigger(command) {
  const m = GH_TRIGGER.exec(String(command ?? ''));
  return m ? `gh ${m[1]} ${m[2]}` : null;
}

// Prose-bearing flags on the covered subcommands. -F is --body-file on
// pr/issue and --notes-file on release create; both read a file, so one
// entry covers them.
const VALUE_FLAGS = {
  '--title': '--title',
  '-t': '--title',
  '--body': '--body',
  '-b': '--body',
  '--notes': '--notes',
  '-n': '--notes'
};
const FILE_FLAGS = {
  '--body-file': '--body-file',
  '--notes-file': '--notes-file',
  '-F': '-F'
};

// gh api publishes through typed fields. Only prose keys are checked; a
// field like state=closed is protocol, not prose.
const API_FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field']);
const API_PROSE_KEYS = new Set(['body', 'title', 'description', 'notes']);

const SEPARATOR = /^[;&|]+$/;

/**
 * Tokenize a shell command far enough to find flags and their literal
 * values. Full shell is out of scope: a token whose value depends on
 * expansion ($VAR, $(...), backticks, an unterminated quote) is marked
 * unsafe, and the caller routes it to the unresolved path instead of
 * guessing what the shell would produce.
 */
export function tokenize(command) {
  const tokens = [];
  const s = String(command ?? '');
  let value = '';
  let unsafe = false;
  let started = false;
  const push = () => {
    if (started) tokens.push({ value, unsafe });
    value = '';
    unsafe = false;
    started = false;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      started = true;
      const end = s.indexOf("'", i + 1);
      if (end === -1) {
        value += s.slice(i + 1);
        unsafe = true;
        break;
      }
      value += s.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      started = true;
      i++;
      let closed = false;
      while (i < s.length) {
        if (s[i] === '"') {
          closed = true;
          i++;
          break;
        }
        if (s[i] === '\\' && i + 1 < s.length) {
          value += s[i + 1];
          i += 2;
          continue;
        }
        if (s[i] === '$' || s[i] === '`') {
          unsafe = true;
        }
        value += s[i];
        i++;
      }
      if (!closed) {
        unsafe = true;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\n') {
      push();
      i++;
      continue;
    }
    if (c === ';' || c === '&' || c === '|' || c === '<' || c === '>') {
      push();
      let run = '';
      while (i < s.length && ';&|<>'.includes(s[i])) {
        run += s[i];
        i++;
      }
      tokens.push({ value: run, unsafe: false });
      continue;
    }
    if (c === '\\' && i + 1 < s.length) {
      started = true;
      value += s[i + 1];
      i += 2;
      continue;
    }
    started = true;
    if (c === '$' || c === '`') {
      unsafe = true;
    }
    value += c;
    i++;
  }
  push();
  return tokens;
}

function splitFlag(token) {
  const eq = token.value.indexOf('=');
  if (token.value.startsWith('-') && eq > 0) {
    return { flag: token.value.slice(0, eq), inline: { value: token.value.slice(eq + 1), unsafe: token.unsafe } };
  }
  return { flag: token.value, inline: null };
}

/**
 * The text a gh command publishes, extracted for linting. Returns null when
 * the command is not a covered gh invocation. Otherwise returns
 * { target, payloads, unresolved }: payloads are { label, text } literals
 * ready to lint, and unresolved are { label, reason } values the extractor
 * refused to guess at — expansions, stdin, heredocs, unreadable files. The
 * caller decides what an unresolved value means; the extractor only
 * refuses to invent text.
 */
export function extractGhTexts(command, { readFile } = {}) {
  const read = readFile ?? ((p) => fs.readFileSync(p, 'utf8'));
  const tokens = tokenize(command);
  const payloads = [];
  const unresolved = [];
  let target = null;

  const fileContents = (label, token) => {
    if (token.unsafe) {
      unresolved.push({ label, reason: 'shell expansion in the file path' });
      return;
    }
    if (token.value === '-') {
      unresolved.push({ label, reason: 'reads stdin' });
      return;
    }
    try {
      payloads.push({ label, text: read(token.value) });
    } catch {
      unresolved.push({ label, reason: `cannot read ${token.value}` });
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value !== 'gh' || tokens[i].unsafe) continue;
    const a = tokens[i + 1]?.value;
    const b = tokens[i + 2]?.value;
    const isApi = a === 'api';
    const isTrigger = /^(pr|issue|release)$/.test(a ?? '') && /^(create|comment|edit|review)$/.test(b ?? '');
    if (!isApi && !isTrigger) continue;
    const segTarget = isApi ? 'gh api' : `gh ${a} ${b}`;
    if (!target) target = segTarget;

    let j = i + (isApi ? 2 : 3);
    for (; j < tokens.length && !SEPARATOR.test(tokens[j].value); j++) {
      const token = tokens[j];
      if (token.value === '<<' || token.value === '<<-') {
        unresolved.push({ label: segTarget, reason: 'heredoc' });
        continue;
      }
      const { flag, inline } = splitFlag(token);
      const valueToken = inline ?? (tokens[j + 1] && !SEPARATOR.test(tokens[j + 1].value) ? tokens[j + 1] : null);

      if (isApi) {
        if (flag === '--input') {
          unresolved.push({ label: '--input', reason: 'request body from a file the checker does not parse' });
          if (!inline) j++;
          continue;
        }
        if (!API_FIELD_FLAGS.has(flag)) continue;
        if (!valueToken) continue;
        if (!inline) j++;
        const eq = valueToken.value.indexOf('=');
        if (eq <= 0) continue;
        const key = valueToken.value.slice(0, eq);
        if (!API_PROSE_KEYS.has(key)) continue;
        const label = `${flag} ${key}`;
        const rest = valueToken.value.slice(eq + 1);
        if (flag === '-F' && rest.startsWith('@')) {
          fileContents(label, { value: rest.slice(1), unsafe: valueToken.unsafe });
        } else if (valueToken.unsafe) {
          unresolved.push({ label, reason: 'shell expansion in the value' });
        } else if (rest) {
          payloads.push({ label, text: rest });
        }
        continue;
      }

      if (FILE_FLAGS[flag]) {
        if (!valueToken) {
          unresolved.push({ label: flag, reason: 'missing value' });
          continue;
        }
        if (!inline) j++;
        fileContents(FILE_FLAGS[flag], valueToken);
        continue;
      }
      if (VALUE_FLAGS[flag]) {
        const label = VALUE_FLAGS[flag];
        if (!valueToken) {
          unresolved.push({ label, reason: 'missing value' });
          continue;
        }
        if (!inline) j++;
        if (valueToken.unsafe) {
          unresolved.push({ label, reason: 'shell expansion in the value' });
        } else if (valueToken.value) {
          payloads.push({ label, text: valueToken.value });
        }
      }
    }
    i = j - 1;
  }

  if (!target) return null;
  return { target, payloads, unresolved };
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
