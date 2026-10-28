# The Vale engine

How just-say-so finds and reads a Vale config, how targets map to lint names, how to narrow rules per target, and how the vocabulary exempts a term.

Every check runs Vale. Vale is markup-aware, so code blocks and inline code in Markdown never match a rule. Each rule has its own severity, and any style in Vale's ecosystem plugs in. The same `.vale.ini` drives your editor squiggles, pre-commit, CI, and this plugin.

A check resolves its Vale config in this order, and the first match applies:

1. `vale.config` in the just-say-so config — an explicit path.
2. The nearest `.vale.ini` above the checked file, the walk Vale itself does.
3. The shipped fallback ([vale/fallback.ini](../vale/fallback.ini)), which loads the `JustSaySo` style alone. The plugin works without a `.vale.ini`, and a repo that adds one brings its own styles into the check.

Severity is the policy language. `error` alerts block, at the Stop gate, at the `gh`/MCP deny, and in your CI. `warning` and `suggestion` alerts arrive at edit time as advice and never block. Set a rule's level in `.vale.ini` to move it between those tiers. `files.show` sets the lowest level the agent sees at edit time.

Chat replies lint under the name `reply.reply`. Published text lints under `<source>.<tool>.<field>.publish`: a PR body is `gh.pr.body.publish`, a release title is `gh.release.title.publish`, and a Jira call is `mcp.jira.create_issue.publish`. Those extensions are the contract with your `.vale.ini`: a `[*.reply]` section picks the rules for chat, `[*.publish]` the rules for published text, and `[gh.*.title.publish]` the rules for titles alone. A `[*.md]` section never matches them, so your document rules (heading style, paragraph length) stay out of text that has no document. The `[formats]` lines below parse both as Markdown, so code spans are still skipped.

Write the shared rules once in a `[*]` section and narrow them per target with `Style = NO` or `Style.Rule = level` lines. Two Vale behaviors decide what works. A `Style.Rule = level` line in `[*]` applies in every narrower section. A `BasedOnStyles` line in a narrower section replaces the `[*]` list instead of adding to it, so repeat the whole list or leave the line out.

```ini
[formats]
reply = md
publish = md

[*]
BasedOnStyles = JustSaySo, ai-tells

[*.reply]
ai-tells.ParagraphLength = NO

[gh.*.title.publish]
ai-tells.SentenceLength = NO
```

**The JustSaySo package** packages the banned list as Vale rules ([styles/JustSaySo/](../styles/JustSaySo/)) together with a `.vale.ini` that carries the `[formats]` lines and the `[*.reply]` and `[*.publish]` sections. Add it to a repo's `Packages` and run `vale sync`, and Vale merges those sections into the repo's config. Your own keys win on conflict, and `BasedOnStyles` lists in the same section combine. A repo that uses the package needs no chat sections of its own:

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
```

`scripts/build.js` generates the style from [rules/manifest.json](../rules/manifest.json), and a test fails when the two drift. The patterns treat a hyphen as a word character: `robust-websocket` never matches. A phrase matches with a space or a hyphen, and a curly quote matches its straight form. The rules are plain `existence` and `substitution` rules without `nonword`, so a Vale vocabulary exempts a term or a collocation from them. The package's `.vale.ini` is [vale/fallback.ini](../vale/fallback.ini) without its `StylesPath` line, so the fallback and the package lint the same way.

## Exemptions and the vocabulary

The rules permit a buzzword "when it has precise meaning or is relevant to the domain." A linter cannot make that judgment, and the model would argue its way through it. Whether a term is a real domain term is a fact about your project, and the exemption belongs to your project. The `/just-say-so:allow` command stores it in the right place:

`/allow` appends the term to the vocabulary's `accept.txt`, under the `StylesPath` and `Vocab` that the nearest `.vale.ini` names. When the ini lacks those keys, the command adds `StylesPath = styles` and `Vocab = Project` first. Without a `.vale.ini` the command stops and says so, because the shipped fallback config is not a file to write into. Vale adds every accepted entry to the exception list of every active rule, across all styles. So "robust regression" passes any rule while bare "robust" stays flagged. I verified this against Vale 3.24. The same file serves the editor, the commit hook, CI, and the hooks, so there is no second place to look.

Two Vale facts to know when you edit `accept.txt` by hand. An entry is a case-sensitive regular expression, so `robust regression` does not cover `Robust regression` at the start of a sentence. Run `/allow` once per spelling, or write `[Rr]obust regression` by hand when you need both. `/allow` compares entries exactly for the same reason. And a rule with `nonword: true` ignores the vocabulary. The JustSaySo rules are generated without it for that reason, and a rule of your own that sets it will not honor your exceptions.

In block mode, the rejection message tells the model to suggest the `/just-say-so:allow` command to you, quoting the collocation as it appears in the text.

The hooks also confirm policy edits. When the model edits `.just-say-so.json`, a `.vale.ini`, a vocabulary `accept.txt`, or the global config through the file tools, the hook returns `permissionDecision: "ask"`. You get a confirmation prompt before the edit applies. The vocabulary is the model's easiest self-exemption, so it gets the same prompt. The prompt gives you visibility. A shell command can write the same file without one, so the prompt is no security control.
