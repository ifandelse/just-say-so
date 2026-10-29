---
title: "Reword or drop a shipped bullet"
description: "Replace a shipped bullet's text by id, or remove it, without touching the manifest."
sidebar:
  order: 6
---

**Goal.** A shipped bullet reads the way you would write it, or is gone.

**Precondition.** None beyond the plugin. The extra file is created if it does not exist.

## Steps

1. Find the bullet's id in [rules/manifest.json](https://github.com/ifandelse/just-say-so/blob/main/rules/manifest.json). The ids are short slugs such as `define-on-first-use` and `headings-and-lists`.

2. In `.just-say-so-rules.json` in the project root, add a bullet with that id. To reword:

   ```json
   { "sections": [{ "title": "Mine", "rules": [
     { "id": "define-on-first-use", "full": "Define every term the reader may not know in the sentence that first uses it.", "short": "Define a term on first use.", "vale": [] }
   ] }] }
   ```

   To drop: `{ "id": "headings-and-lists", "drop": true }`.

3. Confirm with the doctor: the `extra rules` line counts `replaced 1` or `dropped 1`. A drop that matches no id is a warning.

## What a replacement carries

A replaced bullet takes your `full`, `short`, and `vale` values whole. Keep the `vale` list from the manifest if the bullet should stay tied to its Vale rules; an empty list makes it a judgment bullet. Giving a `short` text to a bullet that had none adds it to the condensed reminder.
