---
title: "/just-say-so:rules"
description: "Load the full communication rules into the conversation for the rest of the session."
sidebar:
  order: 5
---

## What it does

Loads the full rules text into the conversation and tells the model to apply it to all output for the rest of the session. The full text is what a context start injects by default; this command puts it in front of you too, and re-asserts it in a harness that has no hooks.

## Synopsis

```
/just-say-so:rules
```

## Arguments

None.

## What it reads and writes

Reads the manifest in force, with your extra file merged in. Writes nothing.

## What it prints

The full rules text, rendered from the manifest, with "Checked by" after each bullet that Vale rules back.

## Example

The text opens with the section "Precision first". [The rules](/reference/the-rules/) shows the whole of it.
