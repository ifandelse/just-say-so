---
name: rules
description: Load the full just-say-so communication rules into context and apply them to all output for the rest of the session.
disable-model-invocation: true
allowed-tools: Read, Bash(node *)
---

Apply the following communication rules to all your output for the rest of the session: chat, explanations, docs, reports, answers, file content, code comments, commit messages, and tool use.

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" full`

If the rules text does not appear above, run `node "$CLAUDE_PLUGIN_ROOT/src/cli/print-rules.js" full` with the Bash tool and apply its output.

Acknowledge in one sentence that the rules are active, then continue with whatever the user asks next.
