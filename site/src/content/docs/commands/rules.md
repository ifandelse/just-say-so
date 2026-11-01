---
title: "/just-say-so:rules"
description: "Load the full communication rules into the conversation for the rest of the session."
sidebar:
  order: 5
---

## What it does

Loads the full rules text into the conversation and tells the model to apply it to all output for the rest of the session. It prints the manifest's text as rendered, with your extra file merged in. A context start injects the same text after one adjustment to your Vale config, dropping bullets whose rules are off and naming undescribed error-level rules. This command makes no such adjustment. Use it to read the rules, and to re-assert them in a harness that has no hooks.

## Synopsis

```
/just-say-so:rules
```

## Arguments

None.

## What it reads and writes

Reads the manifest in force, with your extra file merged in. Writes nothing.

## What it prints

The full rules text, rendered from the manifest, with "Checked by" after each bullet that Vale rules back. Not adjusted to the Vale config.

## Example

The text opens with the section "Precision first". [The rules](/reference/the-rules/) shows the whole of it.
