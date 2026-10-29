---
title: "/just-say-so:draft"
description: "Bullets for the Vale rules this project enforces that the reminder only names, grouped by theme, as an extra-rules fragment to paste and edit."
sidebar:
  order: 10
---

## What it does

Writes bullets for Vale rules the reminder can only name. When a project runs a style the shipped rules do not describe, ai-tells say, the reminder names its error-level rules at the end and nothing more. The script lists every such rule with its message, description, link, and a few of the tokens it looks for. The model groups the rules by theme and writes one bullet per theme, with a short text for the reminder, a full text, and the grouped rule ids, and prints the result as a fragment for your extra rules file.

## Synopsis

```
/just-say-so:draft [--all]
```

## Arguments

`--all` includes warning and suggestion rules. By default only error-level rules are listed.

## What it reads and writes

Reads `vale ls-config` and the rule files under the styles path. Writes nothing; you save the fragment yourself.

## What it prints

A JSON fragment in the shape of `rules/manifest.json`, then three sentences on where to save it.

## Example

Save the output as `.just-say-so-rules.json` in the project root, where the plugin finds it with no setting. From then on the reminder carries your sentences instead of the rule names. The doctor warns when a pasted bullet names a rule no installed style has.
