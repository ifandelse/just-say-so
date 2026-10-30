---
title: "6. Add a Vale package and draft its bullets"
description: "Add Google's style to the project, see the reminder name its rules, and draft bullets so it describes them instead."
sidebar:
  order: 6
---

## Where you are

Files and `gh` publishing are gated under the bundled styles: JustSaySo, ai-tells, and STE. Those are a floor. Your project can run any style in Vale's ecosystem beside them.

## Add the package

Edit `.vale.ini`. Add `Google` to `Packages`, and add it to `BasedOnStyles` in a section that covers Markdown files and chat replies, because a restated list in a section starts from that list alone:

```ini
StylesPath = styles
Vocab = Project
Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.19.0/JustSaySo.zip, Google

[{*.md,*.reply}]
BasedOnStyles = JustSaySo, ai-tells, STE, Google
```

Run `vale sync`. [Google](https://github.com/errata-ai/Google) is the Vale style for Google's guide to developer documentation, 36 rules at three levels, and a bare name resolves through the Vale registry.

## See what the agent will get

Run `/just-say-so:doctor`. The `reply` and `files .md` targets now show four styles, with `Google 36 of 36 rules on` at the end. The reply target is the one the hooks read for the rules text. The hooks read that before each injection. From the next context start, the rules text the agent gets ends with a line naming Google rules at error level that no bullet describes, twelve at most, with a count of the rest. The model knows the names and nothing else about them. `/just-say-so:rules` does not show that line. It prints the manifest's text without the adjustment.

## Draft the bullets

```
/just-say-so:draft
```

The script lists every enabled error-level rule no bullet names, with its message, description, link, and a few of the tokens it looks for. The model groups them by theme and writes one bullet per theme, with a short text for the reminder, a full text, and the grouped rule ids, as a JSON fragment. It is a draft: read it, edit the sentences you disagree with, and save it as `.just-say-so-rules.json` in the project root. The plugin finds that file with no setting.

From the next context start, the reminder has your sentences in place of the rule names.

## Check

The doctor's `extra rules` line names the file with `added N, replaced 0, dropped 0`, and the `reply` target still reads `Google 36 of 36 rules on`.

## Next

[Reword a shipped bullet and write one of your own](/tutorial/7-your-own-bullets/).
