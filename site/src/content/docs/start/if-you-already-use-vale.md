---
title: "If you already use Vale"
description: "What just-say-so adds to the linter: Vale at the harness's moments, enforcement per target, the judgment rules, and a record of what you rejected."
sidebar:
  order: 3
---

Vale is a command you run on files. It knows nothing about an agent, a turn, or a reply, and it forgets each run when it exits. just-say-so adds the parts that need a harness. Your Vale setup stays the source of truth.

## What the plugin adds

**It runs Vale at the moments the harness offers, and feeds the result back to the model.** After a write, the agent gets the alerts for the lines it added. Before a `gh` or MCP call publishes text, the call is checked with the text in hand. At the end of a reply, the reply itself is linted. Vale on its own never reaches the model.

**It enforces at the right moment for each target.** A file is gated at the end of the turn, when the agent can still fix it. A publish call is denied before it runs, because nothing can un-publish. A reply is counted and reported on the next prompt.

**It carries the rules a linter cannot express.** "Lead with the answer" is an instruction, not a pattern. The plugin keeps the judgment rules in the model's context across session starts, compaction, and subagents, and trims them to your Vale config: a bullet whose rules you turned off disappears, and error-level rules of yours that no bullet describes are named at the end.

**It remembers what you rejected.** Vale has no record of the reply you found bad. `/just-say-so:restate` keeps it, with your reason and tag. The summary counts, and the advice turns recurring tags into Vale tunes, judgment bullets, and package suggestions.

## What stays yours

- The same `.vale.ini` drives your editor, your CI, the commit gate, and every check here. The plugin reads the nearest one above the file it checks.
- The JustSaySo rules are an ordinary Vale package. Add it to `Packages`, run `vale sync`, and your other styles sit beside it.
- Your vocabulary is Vale's `accept.txt`. `/just-say-so:allow` writes to it; you can edit it by hand.
- Severity is the policy. An `error` can block; a `warning` or `suggestion` is advice. Set levels in `.vale.ini` as you always have.

## Two things to know

Chat replies lint under the name `reply.reply`, and published text under names such as `gh.pr.body.publish`, so one `.vale.ini` narrows rules per target with sections like `[*.reply]`. [The Vale engine](/reference/vale/) has the lint names and the resolution order.

The reminder the model gets is derived from your config, not fixed. `/just-say-so:doctor` prints the plugin's reading of your `.vale.ini` next to the raw sections, so you can check the two agree.
