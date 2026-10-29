---
title: "/just-say-so:allow"
description: "Permit a term the checker flagged, by adding it to the project's Vale vocabulary."
sidebar:
  order: 4
---

## What it does

Adds a term to the project's Vale vocabulary so the checker stops flagging it, in the session and at commit time. The rules permit a buzzword "when it has precise meaning or is relevant to the domain", and whether a term qualifies is a fact about your project, so the fact lives in your project. The term goes into `accept.txt` under the `StylesPath` and `Vocab` the nearest `.vale.ini` names. When the ini lacks those keys, the command adds `StylesPath = styles` and `Vocab = Project` first.

## Synopsis

```
/just-say-so:allow <term>
```

## Arguments

The term, quoted when it holds spaces: `/just-say-so:allow "robust regression"`. Quote the collocation as it appears in the text; the whole phrase is what Vale exempts. An entry is a case-sensitive regular expression, so `robust regression` does not cover `Robust regression` at the start of a sentence. Run the command once per spelling, or edit the file and write `[Rr]obust regression`.

## What it reads and writes

Reads the nearest `.vale.ini`. Writes the term to the vocabulary's `accept.txt`, creating the file and the `Vocab` key when they are missing, and logs an `allow` event. A term already present, with the same case, is reported and not added twice.

## What it prints

One line: the term, the file it went to, and whether it was new.

## Example

In block mode, the rejection message tells the model to suggest this command to you, quoting the flagged collocation. You run it; the model never edits the vocabulary itself, and a hook asks you to confirm if it tries.
