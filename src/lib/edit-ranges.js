// Locate the lines an edit added inside the written file, so PostToolUse
// feedback covers only text this edit produced. On a legacy file the model
// answers for its own additions, not the file's history.

// Every occurrence of `needle` in `content`, as inclusive 1-based line
// ranges. A repeated needle yields the union of candidate ranges: extra
// facts framed as advice cost little, a silent miss defeats the check.
export function findRanges(content, needle) {
  const ranges = [];
  if (!needle) return ranges;
  let from = 0;
  for (;;) {
    const at = content.indexOf(needle, from);
    if (at === -1) break;
    const startLine = content.slice(0, at).split('\n').length;
    const endLine = startLine + needle.split('\n').length - 1;
    ranges.push([startLine, endLine]);
    from = at + 1;
  }
  return ranges;
}

/**
 * Line ranges the tool call added, judged against the file content after
 * the write. Returns an array of [start, end] ranges, or null meaning "the
 * whole file counts" — a Write (no old content to diff against) and any
 * edit we cannot locate fall back to that, and the caller says so.
 */
export function addedRanges(toolName, toolInput, content) {
  if (toolName === 'Edit') {
    const next = toolInput.new_string ?? '';
    if (next === '') return []; // a pure deletion adds no lines
    const ranges = findRanges(content, next);
    return ranges.length > 0 ? ranges : null;
  }
  if (toolName === 'MultiEdit') {
    const ranges = [];
    for (const edit of toolInput.edits ?? []) {
      const next = edit.new_string ?? '';
      if (next === '') continue;
      const found = findRanges(content, next);
      if (found.length === 0) return null; // one unlocatable edit voids the map
      ranges.push(...found);
    }
    return ranges;
  }
  // Write replaces or creates whole files; NotebookEdit stores cell source
  // JSON-escaped, so the raw text never appears verbatim in the file.
  return null;
}

export function inRanges(line, ranges) {
  if (ranges === null) return true;
  return ranges.some(([start, end]) => line >= start && line <= end);
}
