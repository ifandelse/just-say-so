---
name: restate
description: Rewrite the previous reply under the just-say-so communication rules, and record the rejected reply with the user's reason as a labeled example.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" *)
---

The user rejected your previous reply for how it was written. Their reason, if they gave one: $ARGUMENTS

Rewrite that reply under the communication rules below. Keep every fact, decision, number, file path, and code block. Change only the prose. Do not apologize, do not explain the rewrite, and do not mention these rules. If the reason names a specific fault, fix that fault first.

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" condensed`

If the rules text does not appear above, run `node "$CLAUDE_PLUGIN_ROOT/src/cli/print-rules.js" condensed` with the Bash tool and apply its output.

Reply with the rewrite and nothing else.
