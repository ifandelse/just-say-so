---
title: "/just-say-so:restate"
description: "The previous reply broke the rules in a way you noticed. The model rewrites it, and the plugin records the rejected reply, your reason, and your tags."
sidebar:
  order: 3
---

## What it does

Rejects the previous reply. The model rewrites it under the condensed rules, keeping every fact, number, path, and code block and changing only the prose. The plugin records the rejected reply as the model wrote it, read from the transcript rather than from memory, with your reason, the tags in it, the prompt that produced the reply, the model id, and the distance from the last rules injection. When the rewrite lands, it joins the same record. Restate exists to capture where the plugin failed you, so the records can show what to change.

## Synopsis

```
/just-say-so:restate [#tag ...] [reason]
```

## Arguments

Free text. Any `#word` in it is a tag: lowercased, with anything outside letters, digits, and hyphens turned into a hyphen. The reason is stored as typed, hash words included. Tags are whatever you choose; there is no list. A tag that matches a bullet's `id` in the rules file ties the rejection to that bullet in the summary.

## What it reads and writes

Reads the transcript for the previous reply. Appends one JSON line to `rejections.jsonl` in the state directory, and logs a `restate` event. Nothing is written into the project, and nothing leaves your machine.

## What it prints

The rewrite, and nothing else. No apology, no explanation of the change.

## Example

```
/just-say-so:restate #undefined-term what is a "pin"? the term was never defined
```

The record holds `reason: "#undefined-term what is a \"pin\"? the term was never defined"` and `tags: ["undefined-term"]`. After three rejections with that tag in one project, [advise](/commands/advise/) has something to say about it.
