---
title: "7. Reword a shipped bullet and write one of your own"
description: "Replace a shipped bullet by id, drop one, and add a judgment bullet for the tag you keep using."
sidebar:
  order: 7
---

## Where you are

`.just-say-so-rules.json` exists with the drafted bullets for ai-tells. The same file can change the shipped bullets.

## Reword a shipped bullet

Open [the rules](/reference/the-rules/) and pick a bullet whose wording you would change. Its id is in `rules/manifest.json`. The id `define-on-first-use` is the one about terms. Add a bullet with that id to your file:

```json
{ "id": "define-on-first-use", "full": "Define every term the reader may not know in the sentence that first uses it, then use it freely.", "short": "Define a term on first use.", "vale": [] }
```

A bullet with a shipped id replaces the shipped one in place: text, short text, and Vale rules alike. Giving a short text to a bullet that had none puts it in the condensed reminder for the first time.

## Drop one

```json
{ "id": "headings-and-lists", "drop": true }
```

That removes the shipped bullet from the full text and the reminder. The doctor warns when a drop names no shipped id.

## Write a judgment bullet

The tag from chapter 3 has no bullet. Give it one:

```json
{ "id": "undefined-term", "full": "Name the file or command a term refers to the first time it appears.", "short": "Say what a term refers to on first use.", "vale": [] }
```

The empty `vale` list marks a judgment bullet: the model follows it, and no linter checks it. From now on the summary classifies `#undefined-term` rejections as covered by a judgment bullet, which changes what advice says about them.

## Check

The doctor's `extra rules` line reads `added N, replaced 1, dropped 1`, with N one higher than before, and `/just-say-so:rules` shows your wording.

## Next

[Read the summary, run advise, apply a change](/tutorial/8-summary-and-advice/). This one needs a few days of records first.
