import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The README and the docs/ pages link to each other and to files in the
 * repo. Every relative link must name a file that exists, and every
 * anchor must name a heading in its target, so a moved section never
 * leaves a dead link behind.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['README.md', 'adapters/README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md') && f !== 'manual-tests.md').map((f) => `docs/${f}`)];

// GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\w\- ]/g, '')
    .replace(/\s+/g, '-');
}

function anchorsOf(text) {
  const out = new Set();
  const counts = new Map();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const base = slug(m[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

function linksOf(text) {
  const out = [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  for (const m of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) out.push(m[1]);
  return out;
}

describe('docs links', () => {
  it('should point every relative link at a file that exists and every anchor at a heading', () => {
    const broken = [];
    for (const page of PAGES) {
      const text = fs.readFileSync(path.join(ROOT, page), 'utf8');
      for (const link of linksOf(text)) {
        if (/^(https?:|mailto:)/.test(link)) continue;
        const [file, anchor] = link.split('#');
        const target = file ? path.resolve(path.dirname(path.join(ROOT, page)), file) : path.join(ROOT, page);
        if (!fs.existsSync(target)) {
          broken.push(`${page}: ${link} (missing file)`);
          continue;
        }
        if (anchor && target.endsWith('.md') && !anchorsOf(fs.readFileSync(target, 'utf8')).has(anchor)) {
          broken.push(`${page}: ${link} (missing anchor)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
