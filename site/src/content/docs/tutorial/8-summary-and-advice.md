---
title: "8. Read the summary, run advise, apply a change"
description: "After a week of use, read what the records say, let advise turn a recurring tag into a change, and apply it."
sidebar:
  order: 8
---

## Where you are

A week or so of sessions in the project, with tags on the rejections you made. Advice uses a threshold of three rejections with one tag in one project.

## Read the summary

```
/just-say-so:summary --since 30d
```

Read three sections. `Rejection rate` is rejections per 100 turns, counted only from rejections that join to a logged turn. `Rules on rejected replies` says which Vale rules matched on the replies you rejected, and `rejected and clean` counts the ones Vale passed, which are the misses only a bullet can cover. `What the tags point at` places each recurring tag in one situation: uncovered, judgment, fired and still shipped, silent, or not enough evidence. [Records and the summary](/reference/records/) defines every number.

## Fill the package cache

```
/just-say-so:packages --refresh
```

This downloads the 25 writing-rule packages in the Vale registry, about 3 MB, and reduces each to its rule names and messages. Advice can then suggest a rule from a package you do not have. Without it, suggestions for other packages come from one-line descriptions, and the advice says so.

## Run advise

```
/just-say-so:advise --since 30d
```

For each situation, the model writes one recommendation with the counts it rests on and the change ready to paste. It names only rules and packages the script printed. For `#undefined-term`, now covered by your judgment bullet, it will say whether the tag kept recurring after the bullet existed, and suggest rewording or a Vale rule if one in the cache matches. For an uncovered tag, it offers a bullet or a rule.

## Apply one change

Pick one recommendation. A `.vale.ini` line goes in the ini. A bullet goes in `.just-say-so-rules.json`. A package goes in `Packages`, followed by `vale sync`. You apply it yourself. The plugin edits no config on its own.

## Check

The doctor shows the change as a new style under the `reply` target, a higher `added` count on the `extra rules` line, or a rule at a new level in the raw sections.

## Next

[Put the commit gate on the repo](/tutorial/9-the-commit-gate/): the same rules for text that reaches the repo without the agent.
