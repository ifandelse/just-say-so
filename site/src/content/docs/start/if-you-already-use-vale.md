---
title: "If you already use Vale"
description: "What just-say-so adds to the linter: Vale at the harness's moments, enforcement per target, the judgment rules, and a record of what you rejected."
sidebar:
  order: 3
---

Vale is a command you run on files. It has no notion of an agent, a turn, or a reply, and it forgets each run when it exits. just-say-so adds the parts that need a harness. Your Vale setup stays the source of truth.

## What the plugin adds

**It runs Vale at the moments the harness offers, and feeds the result back to the model.** After a write, the agent gets the alerts for the lines it added. Before a `gh` or MCP call publishes text, the call is checked with the text in hand. At the end of a reply, the reply itself is linted. Vale on its own has no path to the model.

**It enforces at the right moment for each target.** The Stop gate holds a file at the end of the turn, when the agent can still fix it. The publish hook denies a publish call before it runs, because nothing can un-publish. The reply check counts a reply and reports it on the next prompt.

**It keeps the rules a linter cannot express in front of the model.** "Lead with the answer" is an instruction the model can understand, and no Vale rule can catch a miss. The plugin keeps these judgment rules in the model's context across session starts, compaction, and subagents. It also reads your Vale config before each injection: it leaves out a bullet backed by Vale rules you turned off, and names your error-level rules that no bullet describes at the end.

**It remembers what you rejected.** Vale has no record of the reply you found bad. `/just-say-so:restate` keeps it, with your reason and tag. The summary counts, and the advice turns recurring tags into Vale tunes, judgment bullets, and package suggestions.

## What stays yours

- The same `.vale.ini` drives your editor, your CI, the commit gate, and every check here. The plugin reads the nearest one above the file it checks.
- The JustSaySo package is an ordinary Vale package. Add it to `Packages`, run `vale sync`, and your other styles run beside it. The package bundles two community styles, ai-tells and STE, with the plugin's settings for their rules. One line in your config turns a rule back on or a style off. [.vale.ini as the plugin reads it](/configuration/vale-ini/) has both recipes.
- Your vocabulary is Vale's `accept.txt`. `/just-say-so:allow` writes to it, and you can edit it by hand. Vale ignores the vocabulary for a rule that sets `nonword`, which most ai-tells rules do, and the command says so when that is the case.
- Severity is the policy. An `error` can block. A `warning` or `suggestion` is advice. Set levels in `.vale.ini` as you always have.

## What to know before the first run

Chat replies lint under the name `reply.reply`, and published text under names such as `gh.pr.body.publish`, so one `.vale.ini` narrows rules per target with sections like `[*.reply]`. [The Vale engine](/reference/vale/) has the lint names and the resolution order.

The reminder the model gets is derived from your config, not fixed. `/just-say-so:doctor` prints the plugin's reading of your `.vale.ini` next to the raw sections, so you can check the two agree.
