// The rules a set of Vale style directories defines, with the level each
// rule file declares. Vale names a nested file styles/Style/sub/Rule.yml
// as Style.sub.Rule. `config` under a styles directory holds
// vocabularies, not a style.
import fs from 'node:fs';
import path from 'node:path';

function levelOf(yamlText) {
  const m = /^level:\s*['"]?(error|warning|suggestion)['"]?\s*$/m.exec(yamlText);
  return m ? m[1] : 'warning';
}

/** Map of "Style.Rule" → rule file path across every directory given. */
export function listStyleFiles(stylesDirs) {
  const files = new Map();
  for (const stylesDir of stylesDirs ?? []) {
    if (!stylesDir || !fs.existsSync(stylesDir)) continue;
    for (const style of fs.readdirSync(stylesDir)) {
      const styleDir = path.join(stylesDir, style);
      if (style === 'config' || style.startsWith('.') || !fs.statSync(styleDir).isDirectory()) continue;
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) walk(full);
          else if (name.endsWith('.yml')) {
            const rel = path.relative(styleDir, full).slice(0, -4);
            files.set(`${style}.${rel.split(path.sep).join('.')}`, full);
          }
        }
      };
      walk(styleDir);
    }
  }
  return files;
}

/** Map of "Style.Rule" → declared level across every directory given. */
export function listStyleRules(stylesDirs) {
  const rules = new Map();
  for (const stylesDir of stylesDirs ?? []) {
    if (!stylesDir || !fs.existsSync(stylesDir)) continue;
    for (const style of fs.readdirSync(stylesDir)) {
      const styleDir = path.join(stylesDir, style);
      if (style === 'config' || style.startsWith('.') || !fs.statSync(styleDir).isDirectory()) continue;
      const walk = (dir) => {
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          if (fs.statSync(full).isDirectory()) {
            walk(full);
          } else if (name.endsWith('.yml')) {
            const rel = path.relative(styleDir, full).slice(0, -4);
            let text = '';
            try {
              text = fs.readFileSync(full, 'utf8');
            } catch {
              // an unreadable rule file is a rule with the default level
            }
            rules.set(`${style}.${rel.split(path.sep).join('.')}`, levelOf(text));
          }
        }
      };
      walk(styleDir);
    }
  }
  return rules;
}

/**
 * The rules whose file sets `nonword: true`, as a Set of "Style.Rule".
 * Vale ignores the vocabulary (accept.txt) for these, so an accepted
 * term never exempts a match of theirs.
 */
export function listNonwordRules(stylesDirs) {
  const out = new Set();
  for (const [id, file] of listStyleFiles(stylesDirs)) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      // an unreadable rule file is not known to be nonword
    }
    if (/^nonword:\s*true\s*$/m.test(text)) out.add(id);
  }
  return out;
}
