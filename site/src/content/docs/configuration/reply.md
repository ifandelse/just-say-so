---
title: "reply"
description: "The chat-reply target warns by default, and block is for single-prompt runs."
sidebar:
  order: 3
---

The `reply` target is each finished chat reply. The plugin lints the reply at the end of the turn under the name `reply.reply`.

```jsonc
"reply": { "mode": "warn" }
```

## mode

| Value | Behaviour |
| --- | --- |
| `off` | Replies are not linted, except for the events log, which lints them with counts only. |
| `warn` | The default. The error-level alerts are kept as per-rule counts, and the hook does not interrupt you. On your next prompt the rules go out with a report of what broke, and the model is told to apply it without revising or mentioning earlier replies. |
| `block` | The model must rewrite the reply before the turn ends. When a rewrite keeps the same alerts, the gate waives and lets the turn end. |

## Leave it at warn in interactive sessions

A Stop hook cannot retract text the harness has already printed. In `block` mode you read the original reply and the rewrite both, and a long session fills with pairs. In `warn` mode you read each reply once, and the correction rides the next prompt. The report needs `rules.onViolation` on, which is the default; with it off, the report waits for the next context start.

`block` is the right setting for a single-prompt run such as CI, where there is no next prompt to deliver a report. [Running in a single-prompt job](/reference/commit-gate/#single-prompt-runs-ci) covers that.
