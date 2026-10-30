---
title: "rules"
description: "How and when the rules text goes out, and the files it is built from."
sidebar:
  order: 4
---

The `rules` section controls when the plugin injects the rules text, which rendering goes out, and where the text comes from.

```jsonc
"rules": {
  "onContextStart": ["startup", "resume", "clear", "compact"],
  "contextStartText": "full",
  "onSubagentStart": true,
  "onViolation": true,
  "manifest": null,
  "extra": null,
  "messagesPath": null
}
```

## onContextStart

The context starts that inject the rules: any of `startup`, `resume`, `clear`, and `compact`. The default is all four, so the rules are present at the start of every context. Trim the list when something else, a `CLAUDE.md` say, supplies the rules at startup. `["compact"]` then covers the one start nothing else does.

## contextStartText

Which rendering a context start and a subagent start inject. `full`, the default, is every bullet with its examples and the Vale rules that check it, about 600 words. `condensed` is the short texts, about 330 words. The prompt after a violation always uses the condensed form with the report. Shipped bullets with no short text, three at present, go out only in the full text.

## onSubagentStart

`true`, the default, injects the rules into each subagent when it spawns. A subagent starts with fresh context and never sees the main session's injections.

## onViolation

`true`, the default, injects the condensed reminder with the reply report on the prompt after a reply broke a rule. `false` holds the report for the next context start.

## manifest

A path to a rules manifest of your own, replacing the shipped one. Relative paths resolve against the project. A path that does not exist or is not JSON falls back to the shipped rules. Session start says so once, and the doctor warns. See [the rules manifest and the extra file](/configuration/manifest-and-extra/).

## extra

A path to an extra rules file. `null`, the default, looks for `.just-say-so-rules.json` in the project root or a directory above it. The file adds bullets, replaces shipped ones by id, or drops them.

## messagesPath

A JSON file that overrides the sentences the hooks say, per key. Unlisted keys keep the shipped English. The keys are in `rules/messages.json`. A relative path here resolves against the directory the hook ran from, not the project.
