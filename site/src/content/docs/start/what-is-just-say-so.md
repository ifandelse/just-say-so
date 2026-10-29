---
title: "What is just-say-so"
description: "A Claude Code plugin that puts your communication rules in the harness: Vale on what the agent writes, judgment rules in its context, and advice from the replies you reject."
sidebar:
  order: 1
---

just-say-so is a Claude Code plugin. It puts your communication rules into the harness, so the agent writes under them instead of being asked to remember them.

Agents talk down to you and in shorthand at the same time. The files, pull requests, and pages they write carry the same tells: buzzwords, filler frames, hedges stacked three deep, a flourish at the end of every paragraph. A rule stated once at the start of a session loses force as the context grows. The plugin keeps the rules in force three ways.

## Three pillars

**Vale lints the prose.** [Vale](https://vale.sh) is a prose linter. The plugin runs it at the moments the harness offers: on a file the agent just wrote, before a `gh` or MCP call publishes text, and on each finished chat reply. The agent gets the alerts in its context. Which rules apply is Vale's job, in your `.vale.ini`, so any style in Vale's ecosystem plugs in.

**Judgment rules cover what a linter cannot see.** "Lead with the answer" and "define a term on first use" are instructions the model follows, not patterns Vale can match. The plugin injects the rules text at every context start, into every subagent when it spawns, and again on the prompt after a reply broke a rule. Before each injection it reads your Vale config and trims the text to match: a bullet whose rules you turned off disappears, and error-level rules of yours that no bullet describes are named.

**Your rejections become advice.** When a reply is bad in a way you noticed, `/just-say-so:restate` has the model rewrite it and records the miss with a tag. The records build into a summary of what breaks and how often. Once a tag recurs, `/just-say-so:advise` turns it into a change to make: a Vale setting, a judgment bullet, or a Vale package to install.

## What you see on a normal day

With the default settings, nothing blocks. After the agent writes a file, it gets a message like this one and fixes the file:

```
just-say-so: Vale reports 3 error(s), 0 warning(s), 1 suggestion(s) in notes.md (whole file — this write created or replaced it):
  - L3 error JustSaySo.Leverage: Banned buzzword: 'leverage'. Use a concrete verb: use, apply, rely on. ["leverage"]
  - L3 error JustSaySo.FillerFrames: Banned filler frame: 'It's important to note'. Delete it and state the point directly. ["It's important to note"]
Fix the errors before finishing. Treat warnings and suggestions as advice.
```

A reply that broke a rule costs you nothing at the time. On your next prompt, the rules go out again with a short report of what broke, and the model is told to apply it without mentioning earlier replies.

## Where the rules come from

The shipped rules are adapted from the [ASD-STE100 standard](https://www.asd-ste100.org/) for Simplified Technical English, minus its 900-word dictionary. They live in one file, `rules/manifest.json`, which renders the full text, the condensed reminder, and the Vale rules that check the banned terms, so the three never disagree. You can add bullets of your own, reword or drop shipped ones, or replace the whole set. [The rules](/reference/the-rules/) shows the text as the plugin injects it.

## Next

[Getting started](/start/getting-started/) installs the plugin and walks through one session in about fifteen minutes. [If you already use Vale](/start/if-you-already-use-vale/) says what the plugin adds to the linter.
