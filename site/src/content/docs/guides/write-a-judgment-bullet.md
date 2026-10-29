---
title: "Write a judgment bullet"
description: "Add a rule the model follows and no linter checks, for a miss your rejections keep showing."
sidebar:
  order: 7
---

**Goal.** A recurring miss that Vale cannot detect has a bullet in the rules the agent gets.

**Precondition.** A tag you have been using in `/just-say-so:restate`, or at least a clear sentence for the rule.

## Steps

1. Write the bullet in `.just-say-so-rules.json` in the project root, with an empty `vale` list:

   ```json
   { "sections": [{ "title": "Project rules", "rules": [
     { "id": "undefined-term", "full": "Name the file or command a term refers to the first time it appears.", "short": "Say what a term refers to on first use.", "vale": [] }
   ] }] }
   ```

   Give it the same id as the tag you use when you reject replies for this. The summary then classifies those rejections as covered by this bullet.

2. Write the `full` text as an instruction, not a description: "Do not open with a pleasantry," not "This rule flags pleasantries." Keep the `short` text under 20 words; it is the line in the reminder.

3. Start a new session and run `/just-say-so:rules` to see it in place.

## When it keeps recurring

A judgment bullet only re-injects with the others at context start and after a Vale alert, because only a Vale alert triggers the violation prompt. If the tag keeps coming after the bullet exists, `/just-say-so:advise` says so, and may find a Vale rule in the package cache that checks it.
