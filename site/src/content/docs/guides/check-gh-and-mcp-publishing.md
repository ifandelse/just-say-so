---
title: "Check gh and MCP publishing before it posts"
description: "Turn on the publish sources so a flagged comment or page is denied before the call runs."
sidebar:
  order: 2
---

**Goal.** A `gh pr comment`, a `gh issue create`, or an MCP call that posts a page is checked with the text in hand, and denied when the text carries an error.

**Precondition.** Claude Code 2.1.85 or newer for the `gh` command filter. Older versions work; the hook then runs on every Bash command, with the same results.

## Steps

1. Edit `.just-say-so.json`:

   ```json
   { "publish": { "gh": true, "mcp": ["mcp__confluence__*", "mcp__jira__*"] } }
   ```

   Name the MCP tools by pattern, with `*` wildcards. `publish.mode` is already `block`.

2. Decide what happens to a value the checker cannot read before the call, such as a `$(...)` substitution or a heredoc. The default, `ask`, prompts you. Set `"unresolved": "deny"` for a pipeline that must never guess, or `"allow"` to let those through.

3. Confirm with the doctor: the `targets` line reads `publish block, gh, mcp 2 pattern(s), artifact`.

## Narrowing rules per field

Each value lints as its own fragment, named `gh.<subcommand>.<field>.publish` or `mcp.<server>.<tool>.<field>.publish`. A section in `.vale.ini` narrows one:

```ini
[gh.*.title.publish]
ai-tells.SentenceLength = NO
```

The known gaps are listed in [Checking published text](/reference/publish/).
