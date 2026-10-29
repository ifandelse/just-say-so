// Generate the Reference section from the repository, so the site never
// disagrees with it. Runs before `astro dev` and `astro build`.
//
// - docs/*.md become src/content/docs/reference/<name>.md with a `title`
//   taken from the first heading, which is then dropped from the body.
// - Links between those pages become site links; links to other files in
//   the repository point at GitHub.
// - reference/rules.md renders from rules/manifest.json through the
//   plugin's own renderRules, so the page is the text the hooks inject.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const out = path.join(here, '..', 'src', 'content', 'docs', 'reference');
const GITHUB = 'https://github.com/ifandelse/just-say-so/blob/main';
const SKIP = new Set(['manual-tests.md']);

const { renderRules, shippedManifestPath } = await import(path.join(repo, 'src', 'lib', 'manifest.js'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function frontmatter(title, extra = {}) {
  const lines = ['---', `title: ${JSON.stringify(title)}`];
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${JSON.stringify(v)}`);
  lines.push('---', '');
  return lines.join('\n');
}

// Rewrite the Markdown links a docs/ page carries for its new home.
function rewriteLinks(md) {
  return md.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    const [file, anchor] = target.split('#');
    const hash = anchor ? `#${anchor}` : '';
    if (file.startsWith('../')) return `](${GITHUB}/${file.replace(/^(\.\.\/)+/, '')})`;
    if (file.endsWith('.md')) return `](/reference/${file.slice(0, -3)}/${hash})`;
    return whole;
  });
}

// Reading order for the sidebar; anything not listed follows, alphabetically.
const ORDER = ['hooks', 'configuration', 'vale', 'publish', 'records', 'advice', 'rules', 'commit-gate', 'harnesses', 'upgrading', 'limits'];
const docsDir = path.join(repo, 'docs');
const pages = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md') && !SKIP.has(f)).sort();
for (const name of pages) {
  const slug = name.slice(0, -3);
  const rank = ORDER.indexOf(slug);
  const text = fs.readFileSync(path.join(docsDir, name), 'utf8');
  const m = /^#\s+(.+?)\s*$/m.exec(text);
  const title = m ? m[1] : slug;
  const body = m ? text.slice(m.index + m[0].length) : text;
  fs.writeFileSync(path.join(out, name), frontmatter(title, { sidebar: { order: rank === -1 ? 100 : rank + 1 } }) + rewriteLinks(body.trimStart()));
}

const manifest = JSON.parse(fs.readFileSync(shippedManifestPath(), 'utf8'));
// The page title carries the heading; drop the text's own H2 and keep its intro line.
const rules = renderRules(manifest, 'full').replace(/^## [^\n]*\n\n/, '');
fs.writeFileSync(
  path.join(out, 'the-rules.md'),
  frontmatter('The rules', { sidebar: { order: 0 }, description: 'The communication rules the plugin injects, rendered from rules/manifest.json.' }) +
    `This page is rendered from [rules/manifest.json](${GITHUB}/rules/manifest.json) at build time. It is the full text, the one a context start injects; the condensed reminder is the short form of the same bullets. "Checked by" names the Vale rules behind a bullet; a bullet without one is a judgment rule.\n\n` +
    rules
);
console.log(`sync: wrote ${fs.readdirSync(out).length} reference pages to ${path.relative(repo, out)}`);
