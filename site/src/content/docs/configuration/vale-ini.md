---
title: ".vale.ini as the plugin reads it"
description: "Targets, lint names, sections, the package, and the vocabulary, as the plugin reads your Vale config."
sidebar:
  order: 6
---

Which rules apply to which text is Vale's job, in `.vale.ini`. The plugin adds three things to how you already use that file: names for the text that is not a file, a package that carries the shipped rules, and a vocabulary the `allow` command writes to.

## Lint names

A file lints under its own path, as always. Chat replies lint under the name `reply.reply`. Published text lints under `<source>.<tool>.<field>.publish`: a PR body is `gh.pr.body.publish`, a release title is `gh.release.title.publish`, a Jira call is `mcp.jira.create_issue.description.publish`, and the Artifact page is `artifact.<file>` with its real extension. Two `[formats]` lines map the made-up extensions to Markdown so Vale parses them as prose:

```ini
[formats]
reply = md
publish = md
```

The JustSaySo package carries those lines, so a project that loads the package needs none of its own.

## Sections

Write the shared rules once in `[*]` and narrow per target:

```ini
[*]
BasedOnStyles = JustSaySo, ai-tells

[*.reply]
ai-tells.ParagraphLength = NO

[gh.*.title.publish]
ai-tells.SentenceLength = NO
```

A `BasedOnStyles` line in a section replaces the list from `[*]`, so repeat the styles you want there. A `Style.Rule = NO` line turns one rule off for that target; a `Style.Rule = error` sets its level. A section with an empty `BasedOnStyles` exempts its paths from every style, which is how a repo keeps its docs and tests, which quote the banned words, out of the check. The full model, measured against Vale 3.24, is in [The Vale engine](/reference/vale/).

## The package

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.18.1/JustSaySo.zip
```

The JustSaySo package is the shipped banned-term bullets as Vale rules, plus a `.vale.ini` with the `[formats]` lines and `[*.reply]` and `[*.publish]` sections. Run `vale sync` after adding it. `/just-say-so:init` writes the line pinned at the plugin's version, and the doctor warns when the pin and the plugin disagree.

## The vocabulary

```ini
StylesPath = styles
Vocab = Project
```

`/just-say-so:allow` appends a term to `styles/config/vocabularies/Project/accept.txt`. An entry is a case-sensitive regular expression. A `Vocab` that names a directory which does not exist stops Vale with an error on every run; `init` writes the key and an empty file together, and the doctor warns when they have parted.
