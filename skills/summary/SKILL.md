---
name: summary
description: Summarize what just-say-so has recorded, as facts with their counts. Turns, rejections per 100 turns, how far from the last rules injection replies break, which Vale rules match and which matched on rejected replies, rewrites, reasons, tags and what each recurring tag points at.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/summary.js" *)
---

The user wants the summary of the plugin's records. Arguments given, if any: $ARGUMENTS (`--since 30d`, `--since 2026-10-01`, `--project <path>`, `--json` pass through).

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/summary.js" $ARGUMENTS
```

Show the report verbatim in a code block. Then, in at most three sentences, say which numbers the user should look at and why, using only what the report shows. A rate marked unavailable has no denominator in the window. Say so rather than estimating one. Do not recommend a change here: the section "What the tags point at" names what each recurring tag points at, and `/just-say-so:advise` turns those into recommendations with the project's rules and the package cache in hand.
