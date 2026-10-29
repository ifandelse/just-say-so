---
title: "Block errors in written files but not in replies"
description: "Hold the turn while a written file carries an error, and leave replies on warn."
sidebar:
  order: 1
---

**Goal.** A file the agent writes cannot end the turn with an error-level alert in it, while a reply that breaks a rule is reported on the next prompt and never rewritten in front of you.

**Precondition.** The plugin is installed and the project has a `.vale.ini`.

## Steps

1. Create or edit `.just-say-so.json` in the project root:

   ```json
   { "files": { "mode": "block" } }
   ```

   Leave `reply` out; its default is `warn`.

2. Start a new session. The setting is read at every hook, so a running session picks it up on the next write.

3. Confirm with `/just-say-so:doctor`: the `targets` line reads `files block (show suggestion) · ... · reply warn`.

## If you want it everywhere

Put the same JSON in `~/.config/just-say-so/just-say-so.json`. A project file wins over it when both set a field, so a project can go back to `warn` on its own.

## What block does at the end of a turn

A gate re-lints every file this session wrote and holds the turn while any carries an error-level alert. When a rewrite leaves the same alerts, the gate reports once, lets the turn end, and waives those alerts for the rest of the session. A term that keeps tripping it is a case for [allowing the term](/guides/allow-a-term/). The gate only sees files written through the file tools; the [commit gate](/guides/commit-gate/) covers the rest.
