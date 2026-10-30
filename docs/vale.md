# The Vale engine

How just-say-so finds and reads a Vale config, how targets map to lint names, which styles the plugin bundles, how to narrow rules per target, and how the vocabulary exempts a term.

Every check runs Vale. Vale is markup-aware, so code blocks and inline code in Markdown never match a rule. Each rule has its own severity, and any style in Vale's ecosystem plugs in. The same `.vale.ini` drives your editor squiggles, pre-commit, CI, and this plugin.

A check resolves its Vale config in this order, and the first match applies:

1. `vale.config` in the just-say-so config, an explicit path.
2. The nearest `.vale.ini` above the checked file, the walk Vale itself does.
3. The shipped fallback ([`vale/fallback.ini`](../vale/fallback.ini)), which loads the bundled styles from the plugin's own `styles/` directory. The plugin works without a `.vale.ini`, and a repo that adds one brings its own styles into the check.

Severity is the policy language. `error` alerts block, at the Stop gate, at the `gh`/MCP deny, and in your CI. `warning` and `suggestion` alerts arrive at edit time as advice and never block. Set a rule's level in `.vale.ini` to move it between those tiers. `files.show` sets the lowest level the agent sees at edit time.

## Lint names

Chat replies lint under the name `reply.reply`. Published text lints under `<source>.<tool>.<field>.publish`: a PR body is `gh.pr.body.publish`, a release title is `gh.release.title.publish`, and a Jira call is `mcp.jira.create_issue.publish`. Those extensions are the contract with your `.vale.ini`. A `[*.reply]` section picks the rules for chat, `[*.publish]` the rules for published text, and `[gh.*.title.publish]` the rules for titles alone. A `[*.md]` section never matches them, so your document rules (heading style, paragraph length) stay out of text that has no document. The `[formats]` lines below parse both as Markdown, so code spans are still skipped.

## The bundled styles

The plugin ships three styles under [`styles/`](../styles/), and the JustSaySo package holds all three.

- **JustSaySo** is generated from [`rules/manifest.json`](../rules/manifest.json) by `scripts/build.js`, and a test fails when the two drift. It holds the banned terms that only it reports: the buzzwords, the filler frames, the empty intensifiers, and the `it's not x, it's y` shape. The patterns treat a hyphen as a word character, so `robust-websocket` never matches. A phrase matches with a space or a hyphen, and a curly quote matches its straight form. The rules never set `nonword`, and a vocabulary entry exempts a term or a collocation from them.
- **ai-tells** (the [vale-ai-tells](https://github.com/tbhb/vale-ai-tells) repository) is a community package of 137 rules for the fingerprints of AI prose, every one declared at error level.
- **STE** (the [vale-llm-slop](https://github.com/Syntaf/vale-llm-slop) repository) is 12 rules adapted from ASD-STE100: sentence length, passive voice, noun clusters, dropped articles, and the rest.

[`rules/packages.json`](../rules/packages.json) pins each package at a release with its checksum and records the plugin's setting for every rule it does not leave at the declared level: 14 rules off and 6 at suggestion, chosen rule by rule. `scripts/vendor-packages.js` downloads the pinned zips and unpacks the styles unchanged, with the licences in [`styles/LICENSES.md`](../styles/LICENSES.md). A banned term that a bundled rule already reports is marked `checkedBy` in the manifest: it stays in the rules text and leaves the generated style, so one word raises one alert.

The build renders the style sections of the fallback config from the same file, between two marker lines:

```ini
[*]
BasedOnStyles = JustSaySo
ai-tells.OverusedVocabulary = YES
ai-tells.ShipOveruse = NO

[{*.md,*.mdx,*.markdown,*.txt,*.rst,*.adoc,*.asciidoc,*.html,*.htm,*.reply,*.publish}]
BasedOnStyles = JustSaySo, ai-tells, STE
STE.PassiveVoice = suggestion
```

JustSaySo, ai-tells, and STE run on prose formats, chat replies, and published fragments. Code files keep JustSaySo alone under `[*]`, plus the bundled rules that report banned terms, and a code comment is checked for the banned list and nothing wider. A `NO` under `[*]` turns a rule off everywhere. A level line enables the rule wherever it sits, and that keeps the level lines in the prose section.

## Sections

Write the shared rules once in a `[*]` section and narrow them per target with `Style = NO` or `Style.Rule = level` lines. Vale applies two behaviors here. A `Style.Rule = level` line in `[*]` applies in every narrower section. A `BasedOnStyles` line in a narrower section replaces the `[*]` list instead of adding to it, so repeat the whole list or leave the line out.

```ini
[formats]
reply = md
publish = md

[*.reply]
ai-tells.VerbTricolon = YES
STE.SentenceLength = error

[gh.*.title.publish]
STE.SentenceLength = NO

[*.md]
BasedOnStyles = JustSaySo
```

The first section turns a bundled rule back on and raises another for chat replies. The second turns one off for titles. The third drops the bundled styles for Markdown files by restating the list, the way a restated list always dropped the `[*]` styles. The resolution order, measured against Vale 3.24 and kept as an integration test, is in the comment at the top of [`src/lib/rule-state.js`](../src/lib/rule-state.js).

## The JustSaySo package

The package holds a `.vale.ini` with the `[formats]` lines and the style sections above, plus every style under `styles/`. Add it to a repo's `Packages` and run `vale sync`, and Vale merges those sections into the repo's config. Your own keys win on conflict, and `BasedOnStyles` lists in the same section combine. A repo that uses the package needs no chat sections of its own:

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
```

The package's `.vale.ini` is [`vale/fallback.ini`](../vale/fallback.ini) without its `StylesPath` line, so the fallback and the package lint the same way. The doctor warns when a project's synced copy of a bundled style has a different rule count from the plugin's, which means the `Packages` URL points at another plugin version or sync has not run since an update.

## Exemptions and the vocabulary

The rules permit a buzzword "when it has precise meaning or is relevant to the domain." A linter cannot make that judgment, and the model would argue its way through it. Whether a term is a real domain term is a fact about your project, and the exemption belongs to your project. The `/just-say-so:allow` command stores it in the right place.

`/allow` appends the term to the vocabulary's `accept.txt`, under the `StylesPath` and `Vocab` that the nearest `.vale.ini` names. When the ini lacks those keys, the command adds `StylesPath = styles` and `Vocab = Project` first. Without a `.vale.ini` the command stops and says so, because the shipped fallback config is not a file to write into. Vale adds every accepted entry to the exception list of every active rule that honours the vocabulary, across all styles. So a collocation such as a buzzword followed by "regression" passes any rule, and the bare buzzword is still reported. I verified this against Vale 3.24. The same file serves the editor, the commit hook, CI, and the hooks, so there is no second place to look.

Vale ignores the vocabulary for a rule that sets `nonword: true`. That is 90 of the 137 ai-tells rules and 4 of the 12 STE rules, and a rule of your own that sets it. `/allow` lints the term under the project's config before it writes, reads which reporting rules are nonword, and writes the entry only when a rule honours it. For the others it explains the two ways out: reword the phrase, or turn the rule off for the project or one target with a `= NO` line. The doctor lints every existing entry the same way and warns about the entries that only nonword rules report.

When you edit `accept.txt` by hand, keep in mind that an entry is a case-sensitive regular expression, so an entry in lowercase does not cover the same words with a capital at the start of a sentence. Run `/allow` once per spelling, or write a character class such as `[Rr]` by hand when you need both. `/allow` compares entries exactly for the same reason.

In block mode, the rejection message tells the model to suggest the `/just-say-so:allow` command to you, quoting the collocation as it appears in the text.

The hooks also confirm policy edits. When the model edits `.just-say-so.json`, a `.vale.ini`, a vocabulary `accept.txt`, or the global config through the file tools, the hook returns `permissionDecision: "ask"`. You get a confirmation prompt before the edit applies. The vocabulary is the model's easiest self-exemption, so it gets the same prompt. The prompt gives you visibility. A shell command can write the same file without one, so the prompt is no security control.
