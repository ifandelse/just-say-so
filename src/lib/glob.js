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
