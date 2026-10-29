---
title: "publish"
description: "The published-text target: gh commands, MCP tools, and the Artifact page."
sidebar:
  order: 2
---

The `publish` target is text that leaves the machine through a tool call: a `gh pr comment`, an MCP call that posts a page, the page the `Artifact` tool publishes. Nothing can un-publish, so this target checks before the call runs, and `block` is the default. With the defaults, only the Artifact page is checked; the `gh` and MCP sources are opt-in.

```jsonc
"publish": { "mode": "block", "gh": false, "mcp": [], "artifact": true, "unresolved": "ask" }
```

## mode

| Value | Behaviour |
| --- | --- |
| `off` | No publish checks. |
| `warn` | The call runs; the agent gets the alerts and is told to fix the text. |
| `block` | The default. A call with an error-level alert is denied before it runs, with the alerts and a rewrite instruction. |

## gh

`true` checks the `gh` commands that publish prose: `create`, `comment`, `edit`, and `review` under `gh pr`, `gh issue`, and `gh release`, plus `gh api` calls that write a prose field. Each value lints as its own fragment, named `gh.<subcommand>.<field>.publish`, so `.vale.ini` can narrow rules per field. Needs Claude Code 2.1.85 or newer for the command filter; older versions run the hook on every Bash command, with identical results.

## mcp

A list of MCP tool-name patterns, with `*` wildcards, such as `["mcp__confluence__*", "mcp__jira__*"]`. On a matching call, every string argument that holds whitespace lints as its own fragment, named `mcp.<server>.<tool>.<field>.publish`. A string without whitespace is treated as an id and skipped.

## artifact

`true`, the default, checks the page the `Artifact` tool publishes. The hook reads the page at its path before the call and lints it as `artifact.<file>` with its own extension, so Vale parses HTML as HTML.

## unresolved

A published value the checker cannot read before the call: a `$(...)` substitution, a variable, backticks, stdin, a heredoc, or a `gh api --input` file that is not JSON. The checker refuses to guess what the shell will produce. `ask`, the default, asks you to confirm the call; `allow` lets it run; `deny` refuses it. Under a harness mode that answers permissions automatically, `ask` acts as `allow`.

The details and the known gaps are in [Checking published text](/reference/publish/).
