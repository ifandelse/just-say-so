---
title: "Allow a term the checker flags"
description: "Exempt a domain term from the banned list for the session and the commit gate, and what to do when a rule ignores the vocabulary."
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

2. The command lints the term under the project's config to learn which rules report it. When those rules honour the vocabulary, the term goes into `styles/config/vocabularies/Project/accept.txt`, and the output names the rules that stop reporting it. When `.vale.ini` lacks `StylesPath` or `Vocab`, the command adds `StylesPath = styles` and `Vocab = Project` first.

3. Confirm with the doctor: the `vocabulary` line reads `Project (N accepted)`.

## Spelling and case

An entry is a case-sensitive regular expression. `robust regression` does not cover `Robust regression` at the start of a sentence. Run the command once per spelling, or edit `accept.txt` and write `[Rr]obust regression`. Quote the whole collocation, not the bare word. The exemption then covers the one use and not every `robust`.

## When the vocabulary cannot help

Vale ignores `accept.txt` for a rule that sets `nonword: true`. Most ai-tells rules do, because they match phrases across word boundaries. When every rule that reports your term is one of those, the command writes nothing, since the entry would change nothing, and prints the two ways out:

```
"stands down" is reported by ai-tells.EnforcementMetaphors.

That rule matches text across word boundaries, and Vale ignores the project
vocabulary (accept.txt) for rules written that way. An entry there changes
nothing for it, so nothing was written.

You have two ways out:

  1. Rewrite the phrase.
     ai-tells.EnforcementMetaphors: AI enforcement metaphor: 'stands down'. Say what the check refuses or allows.

  2. Turn the rule off for this project. This is per rule, not per phrase:
     every match of the rule stops. Add under [*] in .vale.ini:

       ai-tells.EnforcementMetaphors = NO

     To turn it off for one target only, put the line under [*.reply] or
     [*.md] instead.
```

Rewriting keeps the rule, while turning it off is a per-rule decision, and the agent does not write the `= NO` line for you. The doctor lints every existing entry the same way and warns about the ones that only nonword rules report.

## From the agent's side

In block mode the message the agent gets tells it to suggest this command to you, quoting the flagged collocation. The agent never edits the vocabulary itself, and a hook asks you to confirm if it tries.
