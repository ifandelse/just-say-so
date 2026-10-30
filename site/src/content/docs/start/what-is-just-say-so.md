---
title: "What is just-say-so"
description: "A Claude Code plugin that puts your communication rules in the harness: Vale on what the agent writes, the rules text in its context, and advice from the replies you reject."
sidebar:
  order: 1
---

just-say-so is a Claude Code plugin. It puts your communication rules into the harness. The rules go into the agent's context before it writes, and Vale checks what it wrote afterwards.

Agents use a 'cognitively slippery' verbal shorthand. The files, pull requests, and pages they write show the same tells: buzzwords, filler frames, hedges stacked three deep, a flourish at the end of every paragraph. A rule stated once at the start of a session loses force as the context grows. The plugin keeps the rules in force in three ways.

## What the plugin does

**Proactive communication rules.** "Lead with the answer" and "define a term on first use" are instructions the model follows, not patterns Vale can match. The plugin injects the rules text at every context start, into every subagent when it spawns, and again on the prompt after a reply broke a rule. Before each injection it reads your Vale config and the rules text, always giving your agent the most up-to-date rules on how to communicate.

**Linting of generated text.** [Vale](https://vale.sh) is a prose linter. The plugin runs Vale at the moments the harness offers: on a file the agent just wrote, before a `gh` or MCP call publishes text, and on each finished chat reply. The agent gets the alerts in its context. The alerts can be advisory, or blocking errors that force the agent to fix the issue(s). Which rules apply is Vale's job, in your `.vale.ini`, so any style in Vale's ecosystem plugs in.

**Guided self-improvement.** When slop text gets past the checks, the `/just-say-so:restate` skill has the model rewrite it and records the miss with a tag. The records build into a summary of what breaks and how often. Once a tag recurs, `/just-say-so:advise` turns it into a change to make: a Vale setting, a judgment bullet, or a Vale package to install.

## Linting and rules injection

The plugin does two separate things: injects the rules text into the context window and lints model output.

|                        | Linting                                                                                            | Injection                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| What it is             | Vale runs over text and reports alerts.                                                            | The rules text is placed in the model's context.                                                      |
| What drives it         | Vale rules, from the bundled styles and any package you add, selected in `.vale.ini`.              | The bullets in the rules manifest.                                                                    |
| Where it applies       | Written files, published text (`gh`, MCP tools, the Artifact page), and chat replies.              | Everything the model writes from then on.                                                             |
| How reliable it is     | Deterministic. The same text gets the same alerts every time.                                      | Variable. The model follows an instruction most of the time and ignores it some of the time.          |
| What happens on a miss | An error can hold a turn, deny a publish call, or be reported on the next prompt.                  | Nothing, on its own.                                                                                  |

One point connects them. When Vale finds an error in a finished chat reply, the next prompt includes the rules text again, with a report of what broke. That is the plugin's answer to instructions fading as a session grows: the linter notices, and the reminder follows. It only works for a bullet that Vale rules back. A judgment rule has no linter behind it. Breaking one produces no alert and no reminder, and the only record of the miss is the one you make with `/just-say-so:restate`. You _can_ remind the agent of the rules text as well, with the `/just-say-so:remind` skill.

The rules manifest belongs to both columns. Its bullets are the injected text, and each bullet names the Vale rules that check it, so a bullet and the rules behind it come from one record.

## What you see on a normal day

With the default settings, written files and replies are on `warn`: the agent is told what broke and nothing is held. Publishing is on `block` for the Artifact page from the start, because nothing can un-publish. After the agent writes a file, it gets a message like this one and fixes the file:

```
just-say-so: Vale reports 5 error(s), 0 warning(s), 1 suggestion(s) in notes.md (whole file — this write created or replaced it):
  - L3 error JustSaySo.FillerFrames: Banned filler frame: 'It's important to note'. Delete it and state the point directly. ["It's important to note"]
  - L3 error ai-tells.OverusedVocabularyVerbs: AI vocabulary (verb form): 'leverage'. Replace with a direct verb. ["leverage"]
  - L3 error ai-tells.OverusedVocabulary: AI vocabulary: 'streamline'. Replace with a more specific or common word. ["streamline"]
  - L3 suggestion JustSaySo.Intensifiers: Empty intensifier: 'very'. Replace it with a measurement or a concrete consequence. ["very"]
Fix the errors before finishing. Treat warnings and suggestions as advice.
```

A reply that broke a rule costs you nothing at the time. On your next prompt, the rules go out again with a short report of what broke, and the model is told to apply it without mentioning earlier replies.

## Where the two kinds of rule come from

The plugin runs two kinds of rules. On this site, "rule" always means one or the other.

**Judgment rules** are the bullets in the rules text: instructions the model follows and no linter can check. The shipped set is adapted from the [ASD-STE100 standard](https://www.asd-ste100.org/) for Simplified Technical English, minus its 900-word dictionary limit. They live in one file, `rules/manifest.json`, and you can add bullets of your own, reword or drop shipped ones, or replace the whole set. See [the rules](/reference/the-rules/) for the complete text.

**Vale rules** are patterns a linter matches. The plugin bundles three styles. JustSaySo is generated from the manifest: the banned buzzwords, the filler frames, the `it's not x, it's y` shape, and the empty intensifiers, so a bullet and the rule that checks it never disagree. [ai-tells](https://github.com/tbhb/vale-ai-tells) is a community package of 137 rules for the fingerprints of AI prose, and [STE](https://github.com/Syntaf/vale-llm-slop) checks the sentence mechanics the bullets describe. The plugin pins both at a release, ships the settings it chose for every rule, and leaves the rule files unchanged. Any other package you add in `.vale.ini` runs beside them.

A bullet records the Vale rules that back it in its `vale` field, and a bullet with an empty list is a judgment rule. [Judgment rules and Vale rules](/concepts/judgment-rules-and-vale-rules/) explains why the plugin keeps both.

Each bundled rule that is on is named by a bullet, so the injected text and the linter agree on what is enforced. When you install a further package, its error-level rules that no bullet describes are named at the end of the text, and `/just-say-so:draft` writes bullets for them.

## Next

[Getting started](/start/getting-started/) installs the plugin and walks through one session in about fifteen minutes. [If you already use Vale](/start/if-you-already-use-vale/) says what the plugin adds to the linter.
