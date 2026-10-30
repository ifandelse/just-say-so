---
title: ".vale.ini as the plugin reads it"
description: "Targets, lint names, sections, the package with its bundled styles, and the vocabulary, as the plugin reads your Vale config."
sidebar:
  order: 6
---

Which rules apply to which text is Vale's job, in `.vale.ini`. The plugin adds three things to how you already use that file: names for the text that is not a file, a package that holds the shipped rules and the bundled styles, and a vocabulary the `allow` command writes to.

## Lint names

A file lints under its own path, as always. Chat replies lint under the name `reply.reply`. Published text lints under `<source>.<tool>.<field>.publish`: a PR body is `gh.pr.body.publish`, a release title is `gh.release.title.publish`, a Jira call is `mcp.jira.create_issue.description.publish`, and the Artifact page is `artifact.<file>` with its real extension. Two `[formats]` lines map the made-up extensions to Markdown so Vale parses them as prose:

```ini
[formats]
reply = md
publish = md
```

The JustSaySo package holds those lines, so a project that loads the package needs none of its own.

## The package

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.19.0/JustSaySo.zip
```

The package is a complete Vale package with three styles. JustSaySo is the shipped banned-term bullets as Vale rules. ai-tells and STE are community packages the plugin bundles, pinned at a release and unchanged. The package's `.vale.ini` has the `[formats]` lines and two style sections:

```ini
[*]
BasedOnStyles = JustSaySo
ai-tells.OverusedVocabulary = YES
ai-tells.ShipOveruse = NO

[{*.md,*.mdx,*.markdown,*.txt,*.rst,*.adoc,*.asciidoc,*.html,*.htm,*.reply,*.publish}]
BasedOnStyles = JustSaySo, ai-tells, STE
STE.PassiveVoice = suggestion
```

JustSaySo, ai-tells, and STE run on prose formats, chat replies, and published text. Code files keep JustSaySo plus the bundled rules that report banned terms, and a code comment is checked for the banned list and nothing wider. The `NO` and level lines are the plugin's choices for the bundled rules, 14 off and 6 at suggestion out of 149. The reference page [The Vale engine](/reference/vale/) lists where the choices are recorded and how the build renders them.

Run `vale sync` after adding the package. `/just-say-so:init` writes the line pinned at the plugin's version, and the doctor warns when the pin and the plugin disagree, or when a synced copy of a bundled style has a different rule count from the plugin's.

## Sections

Write the shared rules once in `[*]` and narrow per target. A `Style.Rule = NO` line turns one rule off for that target. A `Style.Rule = YES` line turns one on. A `Style.Rule = error` line sets its level. A `BasedOnStyles` line in a section replaces the list from `[*]` and from the package's prose section, so repeat the styles you want there.

### Turn a bundled rule on, off, or to another level

```ini
[*]
ai-tells.VerbTricolon = YES
ai-tells.FigurativeCarries = NO
STE.SentenceLength = error
```

A line under `[*]` applies to every target. Put it under `[*.reply]` or `[*.md]` to change one target.

### Drop a bundled style for one format

```ini
[*.md]
BasedOnStyles = JustSaySo
```

The package adds the bundled styles through a section for the prose formats. A more specific section that restates `BasedOnStyles` starts from its own list, so this keeps JustSaySo and drops ai-tells and STE for Markdown files. Chat replies and published text keep all three unless you add the same line under `[*.reply]` or `[*.publish]`.

### Exempt paths from every style

A section with an empty `BasedOnStyles` exempts its paths from every style, which is how a repo keeps its docs and tests, which quote the banned words, out of the check:

```ini
[{rules/*,test/**}]
BasedOnStyles =
```

The full model, measured against Vale 3.24, is in [The Vale engine](/reference/vale/).

## The vocabulary

```ini
StylesPath = styles
Vocab = Project
```

`/just-say-so:allow` appends a term to `styles/config/vocabularies/Project/accept.txt`. An entry is a case-sensitive regular expression. A `Vocab` that names a directory which does not exist stops Vale with an error on every run. `init` writes the key and an empty file together, and the doctor warns when they have parted.

Vale ignores the vocabulary for a rule that sets `nonword: true`, which most ai-tells rules do. The `allow` command says so when a rule you are reacting to is one of them, and points at the `= NO` line above instead. The doctor warns about an existing entry that only nonword rules report.
