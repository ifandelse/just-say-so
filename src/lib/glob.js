import path from 'node:path';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Supports **, *, ? — enough for file include/exclude lists.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp('^' + re + '$');
}

// Expand brace alternatives: "{a,b}c" → ["ac", "bc"], nesting included.
function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  let depth = 0;
  let close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return [glob];
  const body = glob.slice(open + 1, close);
  const parts = [];
  depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if ((c === ',' && depth === 0) || i === body.length) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return parts.flatMap((p) => expandBraces(head + p + tail));
}

/**
 * A Vale section glob as a RegExp: `{a,b}` alternatives, `**`, `*`, `?`,
 * and `[...]` classes, matched against the whole name. This is the
 * syntax Vale's own config matcher accepts, so a section such as
 * `[{*.reply,*.publish}]` resolves the way Vale resolves it.
 */
export function valeGlobToRegExp(glob) {
  const alternatives = expandBraces(String(glob)).map((g) => {
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*') {
        if (g[i + 1] === '*') {
          re += '.*';
          i += 1;
          if (g[i + 1] === '/') i += 1;
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if (c === '[') {
        const end = g.indexOf(']', i + 1);
        if (end === -1) {
          re += '\\[';
        } else {
          re += g.slice(i, end + 1).replace(/^\[!/, '[^');
          i = end;
        }
      } else {
        re += escapeRegExp(c);
      }
    }
    return re;
  });
  return new RegExp('^(?:' + alternatives.join('|') + ')$');
}

function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/**
 * A pattern without a slash matches the basename, like gitignore. A pattern
 * with a slash matches the absolute path, and also the path relative to cwd
 * when one is given — so a project config can say "docs/**".
 */
export function matchesGlob(filePath, glob, cwd) {
  const p = toPosix(filePath);
  const regex = globToRegExp(glob);
  if (!glob.includes('/')) return regex.test(p.split('/').pop());
  if (regex.test(p)) return true;
  if (cwd) {
    const rel = path.relative(cwd, filePath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return regex.test(toPosix(rel));
    }
  }
  return false;
}

export function matchesAny(filePath, globs, cwd) {
  return (globs ?? []).some((g) => matchesGlob(filePath, g, cwd));
}
