---
title: "/just-say-so:allow"
description: "Permit a term the checker flagged, by adding it to the project's Vale vocabulary, and learn when a rule ignores the vocabulary."
sidebar:
  order: 4
---

## What it does

Adds a term to the project's Vale vocabulary so the checker stops flagging it, in the session and at commit time. The rules permit a buzzword "when it has precise meaning or is relevant to the domain", and whether a term qualifies is a fact about your project. The fact belongs in your project for that reason. The term goes into `accept.txt` under the `StylesPath` and `Vocab` the nearest `.vale.ini` names. When the ini lacks those keys, the command adds `StylesPath = styles` and `Vocab = Project` first.

Before it writes, the command lints the term under the project's config to learn which rules report it. Vale ignores the vocabulary for a rule that sets `nonword: true`, which most ai-tells rules do. When every reporting rule is one of those, the command writes nothing and explains the two ways out: reword the phrase, or turn the rule off with a `= NO` line in `.vale.ini`. When some reporting rules honour the vocabulary and some do not, it writes the entry for the first kind and explains the rest.

## Synopsis

```
/just-say-so:allow <term>
```

## Arguments

The term, quoted when it holds spaces: `/just-say-so:allow "robust regression"`. Quote the collocation as it appears in the text, because the whole phrase is what Vale exempts. An entry is a case-sensitive regular expression, so `robust regression` does not cover `Robust regression` at the start of a sentence. Run the command once per spelling, or edit the file and write `[Rr]obust regression`.

## What it reads and writes

Reads the nearest `.vale.ini`, runs `vale ls-config` and one lint of the term, and reads the rule files of the rules that report it. Writes the term to the vocabulary's `accept.txt` when a reporting rule honours it, creating the file and the `Vocab` key when they are missing, and logs an `allow` event with the rules the entry could not reach. A term already present, with the same case, is reported and not added twice.

## What it prints

The file the term went to and whether it was new, then the rules that stop reporting it. When vale cannot lint the term, the entry is written as before and the output says that which rules it silences is unknown. When a reporting rule ignores the vocabulary, the output names it, quotes the rule's own advice for a rewrite, and prints the `= NO` line for the alternative without writing it. [Allow a term the checker flags](/guides/allow-a-term/) shows that output.

## Example

In block mode, the rejection message tells the model to suggest this command to you, quoting the flagged collocation. You run it. The model never edits the vocabulary itself, and a hook asks you to confirm if it tries.
