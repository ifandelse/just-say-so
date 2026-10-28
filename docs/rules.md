# The rules manifest, your own bullets, and your own voice

## The rules manifest

[rules/manifest.json](../rules/manifest.json) is the one source for the rules. `npm run build` renders [rules/full.md](../rules/full.md) and [rules/condensed.md](../rules/condensed.md) from it and generates the `JustSaySo` style, and a test fails when any of the three drift. Each rule carries:

- `full`, the text in the full rules, which a context start and a subagent start inject, and `short`, the text in the condensed reminder, which the prompt after a violation carries. A rule without `short` appears in the full text only. `condensed` at the top of the file lists the ids in reminder order.
- `vale`, the Vale rules that check it. An empty list marks a judgment rule such as "lead with the answer" that no linter sees. The full text names them after each bullet, as "Checked by".
- `style`, on the four banned-term rules: the name, message, level, and terms of the generated Vale rule. The `{terms}` placeholder in the text renders that list, so the rules text and the style never disagree about what is banned.

**What the `vale` field buys.** Before every injection, the plugin runs `vale ls-config` for the reply target and adjusts the text, full or condensed, before injecting it. A bullet is left out when every installed Vale rule behind it is turned off; a rule from a style the project never installed does not count. Error-level rules in the project's styles that no bullet names are added as one closing line, twelve at most, so the model at least sees their names. A project that sets `JustSaySo.Intensifiers = NO` and runs `ai-tells.EmDashUsage` at error gets a reminder without the intensifiers bullet and with the em-dash rule named at the end. When `vale` is missing the text goes out unadjusted.

## Bullets for your own Vale rules

A project that runs a style the shipped manifest does not describe, ai-tells say, gets those rules named at the end of the reminder and nothing more. `/just-say-so:draft` writes the missing bullets. It runs `node src/cli/undescribed.js`, which lists every enabled error-level rule for the reply target that no bullet names, with the rule's message, description, link, and a few of the tokens it looks for. The model then groups those rules by theme and writes one bullet per theme, with a `short` text for the reminder, a `full` text, and the grouped ids in `vale`, and prints the result as a `rules.extra` fragment. It is a draft: save it, edit it, and point `rules.extra` at the file. From then on the reminder carries your sentences instead of the names. `--all` includes warning and suggestion rules. The doctor warns when a pasted bullet names a rule no installed style has.

## Bring your own rules

You might hate my rules, fair enough. Two routes:

- `rules.extra` names a manifest fragment, a JSON file with `sections` of rules in the shape of [rules/manifest.json](../rules/manifest.json), which the plugin appends to the shipped manifest. Its rules with a `short` text join the reminder after the shipped ones. This is the place for a bullet about a rule your own Vale style enforces.
- `rules.manifest` replaces the shipped manifest with your own. The generated style still ships the shipped terms; put your own terms in a Vale style of your own and set `JustSaySo = NO` in `.vale.ini` where you disagree.

All the hooks, commands, and config machinery stay the same.

## Bring your own voice

When the checker warns or blocks, it speaks in shipped English sentences (the violation report, the rewrite instruction, the confirmation prompt). Those sentences live in [rules/messages.json](../rules/messages.json). To reword them, or to run the enforcement side in another language, copy that file, edit the sentences you want, and point `rules.messagesPath` at your copy. Sentences you leave out keep the shipped wording. The `{target}` placeholder is filled at runtime with the name of the file being checked.

The per-term hints ("use a concrete verb...") and the rules text live in [rules/manifest.json](../rules/manifest.json). A full translation edits both files.
