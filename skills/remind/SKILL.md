---
name: remind
description: Re-inject the condensed just-say-so communication rules — a manual version of the interval reminder.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" *)
---

Refresh your attention on the communication rules below. They apply to all output: chat, explanations, docs, reports, answers, file content, code comments, commit messages, and tool use.

!`node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" condensed`

If the rules text does not appear above, run `node "$CLAUDE_PLUGIN_ROOT/src/cli/print-rules.js" condensed` with the Bash tool and apply its output.

Acknowledge in one sentence, then continue with whatever the user asks next.
