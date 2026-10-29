---
title: "Targets and modes"
description: "Why the config is keyed by the kind of text, and why each target blocks at a different moment."
sidebar:
  order: 1
---

A **target** is one kind of text the agent produces. There are three: the `files` it writes, the text it `publish`es through `gh`, MCP tools, and the Artifact tool, and its chat `reply`. A **mode** is what a target does with an error: `off`, `warn`, or `block`.

The config is keyed by target because the right moment to enforce differs by target, and a single global switch would have to pick one moment for all three.

A written file can be fixed after the fact. The agent gets the alerts as soon as the write lands, and in `block` mode the turn is held at its end while a file still carries an error. Nothing is lost by waiting until the end of the turn, and the agent sees the whole file it wrote.

Published text cannot be unpublished. A pull request comment with a banned word in it is on GitHub the moment the command runs. So `publish` is the one target that blocks before the action: the hook extracts the text from the call, lints it, and denies the call. It is also why `block` is the default there, and why values the checker cannot read before the call are a setting of their own.

A reply has already been read by the time it ends. A Stop hook cannot retract text the harness has printed. So the useful enforcement for a reply is a report on the next prompt, which `warn` gives, and `block` is reserved for runs where there is no next prompt.

Which rules apply to which target is a separate question, and it belongs to `.vale.ini`, not to the config. Replies and published text lint under names of their own, `reply.reply` and `<source>.<tool>.<field>.publish`, so one Vale config can narrow rules per target the way it narrows them per file type.
