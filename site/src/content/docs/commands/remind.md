---
title: "/just-say-so:remind"
description: "Inject the condensed reminder now, by hand."
sidebar:
  order: 6
---

## What it does

Injects the condensed reminder, the short texts of the bullets, the way the hook does on the prompt after a violation. Useful in a harness without hooks, and when you want the rules reasserted without loading the full text.

## Synopsis

```
/just-say-so:remind
```

## Arguments

None.

## What it reads and writes

Reads the manifest in force. Writes nothing.

## What it prints

The condensed reminder.

## Example

The reminder opens with "## Communication rules — reminder" and one line per bullet that has a short text.
