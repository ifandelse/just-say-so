---
title: "6. Add a Vale package and draft its bullets"
description: "Add ai-tells to the project, see the reminder name its rules, and draft bullets so it describes them instead."
sidebar:
  order: 6
---

## Where you are

Files and `gh` publishing are gated under the shipped rules. The shipped rules are a floor; your project can run any style in Vale's ecosystem.

## Add the package

Edit `.vale.ini`. Add `ai-tells` to `Packages` and to `BasedOnStyles`:

```ini
StylesPath = styles
Vocab = Project
Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.18.1/JustSaySo.zip, ai-tells

[*]
BasedOnStyles = JustSaySo, ai-tells
```

Run `vale sync`. [ai-tells](https://github.com/tbhb/vale-ai-tells) is a community package of 137 rules that flag the fingerprints of AI prose, every one at error level, and it pairs well with the shipped rules.

## See the reminder change

Start a new session and run `/just-say-so:rules`. The text now ends with a line naming ai-tells rules at error level that no bullet describes, twelve at most, with a count of the rest. The model knows the names and nothing else about them. The doctor's `reply` target now shows two styles.

## Draft the bullets

```
/just-say-so:draft
```

The script lists every enabled error-level rule no bullet names, with its message, description, link, and a few of the tokens it looks for. The model groups them by theme and writes one bullet per theme, with a short text for the reminder, a full text, and the grouped rule ids, as a JSON fragment. It is a draft: read it, edit the sentences you disagree with, and save it as `.just-say-so-rules.json` in the project root. The plugin finds that file with no setting.

From the next context start, the reminder carries your sentences instead of the rule names.

## Check

The doctor's `extra rules` line names the file with `added N, replaced 0, dropped 0`, and the `reply` target reads `JustSaySo 6 of 6 rules on · ai-tells 137 of 137 rules on`.

## Next

[Reword a shipped bullet and write one of your own](/tutorial/7-your-own-bullets/).
