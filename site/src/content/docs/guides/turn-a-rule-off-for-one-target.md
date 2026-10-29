---
title: "Turn a rule off for one target"
description: "Disable or re-level one Vale rule for replies, or for published text, and leave files alone."
sidebar:
  order: 4
---

**Goal.** One rule stops applying to chat replies, or to published text, while it still applies to written files.

**Precondition.** The project's `.vale.ini` loads the JustSaySo package, which carries the `[*.reply]` and `[*.publish]` sections.

## Steps

1. Add a per-rule line to the target's section in `.vale.ini`:

   ```ini
   [*.reply]
   ai-tells.ParagraphLength = NO
   ```

   For a level instead of off: `JustSaySo.Intensifiers = warning`.

2. Confirm with the doctor. The `reply` target's line counts one fewer rule on, and names it under `off:`.

3. For the next session, the reminder follows: a bullet whose Vale rules are all off for the reply target is left out of the text the agent gets.

## Which section

| Text | Section |
| --- | --- |
| Chat replies | `[*.reply]` |
| Everything published | `[*.publish]` |
| One gh field | `[gh.pr.body.publish]`, or `[gh.*.title.publish]` |
| One MCP field | `[mcp.confluence.create_page.body.publish]` |
| Markdown files | `[*.md]` |

A `BasedOnStyles` line inside a section replaces the list from `[*]`, so leave it out when you only want to turn rules off. [The Vale engine](/reference/vale/) has the measured precedence rules.
