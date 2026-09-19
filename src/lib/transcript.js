import fs from 'node:fs';

function parseLines(transcriptPath) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/**
 * Current context size in tokens: the usage block of the newest entry that
 * has one. input + cache_read + cache_creation ≈ what the model last saw.
 */
export function contextSize(transcriptPath) {
  const entries = parseLines(transcriptPath);
  for (let i = entries.length - 1; i >= 0; i--) {
    const usage = entries[i]?.message?.usage ?? entries[i]?.usage;
    if (usage && typeof usage.input_tokens === 'number') {
      return (
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return null;
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

/**
 * Text of the last assistant message. One API message can span several JSONL
 * entries (one per content block), so collect every entry sharing the last
 * assistant message id.
 */
export function lastAssistantText(transcriptPath) {
  const entries = parseLines(transcriptPath);
  let lastId;
  let single = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === 'assistant') {
      lastId = entry.message?.id;
      single = entry;
      break;
    }
  }
  if (!single) return '';
  if (!lastId) return textOf(single.message);
  return entries
    .filter((e) => e?.type === 'assistant' && e.message?.id === lastId)
    .map((e) => textOf(e.message))
    .filter(Boolean)
    .join('\n');
}
