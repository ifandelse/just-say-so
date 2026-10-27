---
name: init
description: Set this project up for just-say-so — write or amend .vale.ini with the JustSaySo package, run vale sync, write .just-say-so.json for the targets you choose, wire the commit gate for the repo's hook tooling, and print the doctor report.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/init.js" *)
---

The user wants to set this project up for just-say-so. The arguments they gave, if any: $ARGUMENTS

Accepted arguments: `--files off|warn|block`, `--publish off|warn|block`, `--gh` (check gh commands), `--mcp <pattern>` (repeatable, for example `--mcp "mcp__atlassian__*"`), `--reply off|warn|block`, `--hook auto|pre-commit|husky|git|none`, `--dry-run`.

If the user gave no arguments, ask one question before running anything: which targets they want checked beyond the defaults (files warn, reply warn, publishing off until a source is named), and whether the agent publishes through `gh` or an MCP tool. Turn the answer into arguments.

Then run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/init.js" $ARGUMENTS
```

Show the output verbatim in a code block. The last part is the doctor report; point out any warning in one sentence each. If the output names a command the user has to run themselves (a dev dependency install, `pre-commit install`), repeat that command on its own line at the end.
