---
title: "Allow a term the checker flags"
description: "Exempt a domain term from the banned list, in the session and at commit time."
sidebar:
  order: 3
---

**Goal.** A word on the banned list that is a real term in this project stops being flagged.

**Precondition.** A `.vale.ini` in the project. Without one, the command says where to add one.

## Steps

1. Run the command with the term as it appears in the text, quoted when it holds spaces:

   ```
   /just-say-so:allow "robust regression"
   ```

2. The term goes into `styles/config/vocabularies/Project/accept.txt`. When `.vale.ini` lacks `StylesPath` or `Vocab`, the command adds `StylesPath = styles` and `Vocab = Project` first.

3. Confirm with the doctor: the `vocabulary` line reads `Project (N accepted)`.

## Spelling and case

An entry is a case-sensitive regular expression. `robust regression` does not cover `Robust regression` at the start of a sentence. Run the command once per spelling, or edit `accept.txt` and write `[Rr]obust regression`. Quote the whole collocation, not the bare word, so the exemption covers the one use and not every `robust`.

## From the agent's side

In block mode the message the agent gets tells it to suggest this command to you, quoting the flagged collocation. The agent never edits the vocabulary itself; a hook asks you to confirm if it tries.
