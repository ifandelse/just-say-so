// The slice of Vale's INI format the plugin reads and writes: flat
// `key = value` lines in the global block, before the first section. That
// covers every config Vale's own docs show. Nothing here parses sections;
// `vale ls-config` answers questions about those.

export const PACKAGE_URL_RE = /https:\/\/github\.com\/ifandelse\/just-say-so\/releases\/download\/(v[^/\s,]+)\/JustSaySo\.zip/;

export function packageUrl(version) {
  return `https://github.com/ifandelse/just-say-so/releases/download/v${version}/JustSaySo.zip`;
}

// Horizontal whitespace only: \s would run past an empty value into the
// next line.
export function readKey(text, key) {
  return new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*?)[ \\t]*$`, 'm').exec(text)?.[1] ?? null;
}

// Insert `key = value` before the first section header, so it lands in the
// global block where Vale reads it.
export function insertKey(text, key, value) {
  const line = `${key} = ${value}\n`;
  const at = text.search(/^\s*\[/m);
  if (at === -1) return text.replace(/\n?$/, '\n') + line;
  return text.slice(0, at) + line + text.slice(at);
}

// Replace an existing `key = ...` line whole, or insert one. The whole
// line is rewritten so an empty `Vocab =` becomes `Vocab = Project`.
export function setKey(text, key, value) {
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key} = ${value}`) : insertKey(text, key, value);
}

/** The Packages entries, trimmed, in order; [] when the key is absent. */
export function packagesOf(text) {
  const raw = readKey(text, 'Packages');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The tag the JustSaySo package is pinned at ("v0.10.0"), or null. */
export function justSaySoTag(text) {
  for (const p of packagesOf(text)) {
    const m = PACKAGE_URL_RE.exec(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * The text with the JustSaySo package pinned at `url`: an existing pin is
 * replaced, otherwise the url joins the Packages list, or a Packages line
 * is added. Returns { text, changed }.
 */
export function withPackage(text, url) {
  const entries = packagesOf(text);
  const next = entries.some((p) => PACKAGE_URL_RE.test(p))
    ? entries.map((p) => (PACKAGE_URL_RE.test(p) ? url : p))
    : [...entries, url];
  const value = next.join(', ');
  const out = setKey(text, 'Packages', value);
  return { text: out, changed: out !== text };
}
