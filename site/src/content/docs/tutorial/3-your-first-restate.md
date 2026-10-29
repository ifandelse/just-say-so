---
title: "3. Your first restate"
description: "Reject a reply the rules did not catch, tag the miss, and see where the record goes."
sidebar:
  order: 3
---

## Where you are

You have seen the rules go out and a report come back. The next miss is one Vale cannot see.

## Reject a reply

Ask the agent to explain some part of your project. When the reply uses a term it never defined, or ends a paragraph with a flourish, or buries the answer in the third paragraph, reject it:

```
/just-say-so:restate #undefined-term it used "pin" three times and never said what a pin is
```

The model rewrites the reply under the rules. It keeps every fact, number, path, and code block and changes only the prose. It does not apologise or explain the change.

## What was recorded

The plugin read the rejected reply from the transcript, so the record holds what the model wrote and not what it remembers writing. It saved one line to `rejections.jsonl` in your state directory, which is `~/.local/state/just-say-so/` unless you moved it, with the rejected reply, your reason as typed, the tag `undefined-term`, the prompt that produced the reply, and the Vale alerts on the rejected text at every level. When the rewrite landed, it joined the record with its own alerts.

Nothing was written into the project. Nothing leaves your machine.

## Why the tag matters

A tag is any `#word` you type. There is no list. The summary counts tags, and when a tag is the id of a bullet in the rules file, the summary knows whether that bullet is a judgment bullet or a Vale-backed one and whether its rules fired. A tag that matches no bullet is the to-do list: a bullet or a rule still to write. Pick a few tags and reuse them; three rejections with one tag in one project is what advice needs.

## Check

```
/just-say-so:summary
```

The `Tags` section reads `undefined-term: 1 · no bullet covers it yet`, and `Rejections given` shows your reason.

## Next

[Block errors in files, keep replies on warn](/tutorial/4-block-errors-in-files/): the first setting you change.
