---
name: summary
description: Summarize what just-say-so has recorded — turns, rejections per 100 turns, how far from the last rules injection replies break, which Vale rules fire and which fired on rejected replies, rewrites, reasons, allows — as facts with their counts.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/summary.js" *)
---

The user wants the summary of the plugin's records. Arguments given, if any: $ARGUMENTS (`--since 30d`, `--since 2026-10-01`, `--project <path>`, `--json` pass through).

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/summary.js" $ARGUMENTS
```

Show the report verbatim in a code block. Then, in at most three sentences, say which numbers deserve attention and why, using only what the report shows. A rate marked unavailable has no denominator in the window; say so rather than estimating one. Do not recommend raising or lowering a Vale rule's level: the report's observations say what the data cannot establish, and the advice step comes later.
