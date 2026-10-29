---
title: "/just-say-so:advise"
description: "What the recurring tags point at, turned into changes to make: a Vale setting, a judgment bullet, or a package to install."
sidebar:
  order: 8
---

## What it does

Turns the summary's situations into recommendations. The script prints the advice inputs: per project, the situations with the reasons you typed, whether each rule a bullet names is installed and on for the reply target and at what level, a shortlist of candidate rules per tag from the styles installed in the project and from the package cache, the project's packages and reply styles, and the registry packages it lacks. The model then writes one recommendation per situation with a change ready to paste, and names only rules and packages the inputs printed.

## Synopsis

```
/just-say-so:advise [--since 30d] [--project <path>] [--json]
```

## Arguments

The same as [summary](/commands/summary/).

## What it reads and writes

Reads what the summary reads, plus `vale ls-config` and the rule files for each project in the report, the package cache in the state directory, and the Vale registry list, fetched live with a 3 second timeout and falling back to a copy shipped with the plugin. Set `JUST_SAY_SO_REGISTRY=shipped` to skip the fetch. Downloads no package archive; [packages](/commands/packages/) does that, on your say-so. Writes nothing.

## What it prints

The inputs, then the model's advice. The first line reports the package cache: empty, with the command that fills it, or its size and age. A candidate's score is word overlap between the tag and its reasons and the rule's id and message; an empty shortlist means this search found nothing, not that no rule exists.

## Example

A recommendation for an uncovered tag might read: add this bullet to `.just-say-so-rules.json`, with `id: "hedging"`, a short text for the reminder, and `vale: ["ai-tells.HedgingPhrases"]`, because that rule is installed and on at error level and its message checks what your three reasons describe.
