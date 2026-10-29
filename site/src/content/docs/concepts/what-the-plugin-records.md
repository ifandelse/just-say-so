---
title: "What the plugin records"
description: "The two state files, what each holds, and what never leaves the machine."
sidebar:
  order: 5
---

Two files in the state directory hold everything the plugin keeps beyond the current session. The directory is the first of these that is set: `JUST_SAY_SO_STATE_DIR`; `$CLAUDE_PLUGIN_DATA/state`, which Claude Code sets for an installed plugin; `$XDG_STATE_HOME/just-say-so`; and otherwise `~/.local/state/just-say-so/`. The doctor does not print it; `/just-say-so:packages` with no arguments names the cache directory inside it. Nothing is written into a project, and nothing leaves the machine.

`rejections.jsonl` holds one record per `/just-say-so:restate`: the rejected reply, the reason and tags, the prompt that produced the reply, the model id, the distance from the last rules injection, the Vale alerts on the rejected text at every level, and the rewrite with its alerts. This is the one file that holds prose, and it holds it because the rejected and rewritten pairs are a test set for any judge that scores replies against the rules.

`events.jsonl` holds one line per countable thing a hook saw: a session start with its settings, a rules injection, a finished reply with its alerts folded to counts per rule and level, a restate, an allow. Rule names, counts, and settings, never prose. Its purpose is the denominator: a rejection only means something as a rate, and the rate needs the turns.

The summary prints rule names, shipped terms, counts, project paths, and your typed reasons. It never prints a prompt or a reply. The package cache, also under the state directory, holds rule names and messages from public Vale packages and nothing of yours. `hook-errors.jsonl` records a hook that threw, with the message and the top of the stack, so a quiet hook is distinguishable from a healthy one.

The events log is never pruned. A line is under 300 bytes, so a year of heavy use is a few megabytes. `events.mode: "off"` writes nothing.
