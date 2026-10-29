---
title: "files"
description: "The written-file target: mode and the alert levels the agent sees at edit time."
sidebar:
  order: 1
---

The `files` target is every file the agent writes through the file tools. After each write, the plugin runs Vale on the file and hands the agent the alerts for the lines the edit added. On a file the agent created or replaced, the whole file counts.

```jsonc
"files": { "mode": "warn", "show": "suggestion" }
```

## mode

| Value | Behaviour |
| --- | --- |
| `off` | No file checks. |
| `warn` | The default. The agent gets the alerts and is told to fix the errors before finishing. The turn can still end with errors in the file. |
| `block` | Adds a gate at the end of the turn. The edit-time check records the error-level alerts on the lines each edit added; the gate re-lints those files and holds the turn while any recorded alert remains. An error on a line the agent did not touch is not recorded and does not hold the turn. When a rewrite leaves the same alerts, the gate reports once, lets the turn end, and waives those alerts for the rest of the session. |

## show

The lowest alert level passed to the agent at edit time: `error`, `warning`, or `suggestion`. The default, `suggestion`, passes everything. Only error-level alerts ever block.

## What counts as a written file

Any path the `Write`, `Edit`, `MultiEdit`, or `NotebookEdit` tools touch. Which of those files Vale checks, and under which rules, is `.vale.ini`'s decision; a section with an empty `BasedOnStyles` exempts its paths. Files the agent writes through a shell command never pass this check; the [commit gate](/reference/commit-gate/) catches those.
