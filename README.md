# just-say-so

Are you frustrated with how agents talk to you, and with the text they produce in Markdown files, pull requests, and other artifacts? You are not alone. `just-say-so` is a Claude Code plugin that pulls together the tools I use to solve this problem. It has three pillars:

- **Vale lints the prose.** [Vale](https://vale.sh) is a prose linter. The plugin runs it on the files the agent writes, on the text it publishes, and on each chat reply, under rules you control in `.vale.ini`.
- **Judgment rules cover what a linter cannot see.** "Lead with the answer" is an instruction the model follows, not a pattern Vale can match. The plugin injects those rules at every context start, into every subagent, and again after a reply broke one.
- **You capture the misses, and they feed advice on your own setup.** `/just-say-so:restate` has the model rewrite a bad reply and records the miss with a tag. The records build into a summary, and the summary into advice.

Already using Vale? [What just-say-so adds](#already-using-vale) is the section for you.

Status: pre-1.0. Minor versions change behavior; see [Upgrading](docs/upgrading.md).

## A first look

The agent writes a file. The plugin runs Vale on the file it just wrote and hands the agent the alerts. Under the default setting the write stands, the agent is told to fix the errors, and the turn can still end with them in place. In `block` mode the turn is held until they are fixed. The message the agent gets:

```
just-say-so: Vale reports 3 error(s), 0 warning(s), 1 suggestion(s) in notes.md (whole file — this write created or replaced it):
  - L3 error JustSaySo.Leverage: Banned buzzword: 'leverage'. Use a concrete verb: use, apply, rely on. ["leverage"]
  - L3 error JustSaySo.Buzzwords: Banned buzzword: 'streamline'. Use a precise domain term or delete it. ["streamline"]
  - L3 error JustSaySo.FillerFrames: Banned filler frame: 'It's important to note'. Delete it and state the point directly. ["It's important to note"]
  - L3 suggestion JustSaySo.Intensifiers: Empty intensifier: 'very'. Replace it with a measurement or a concrete consequence. ["very"]
Fix the errors before finishing. Treat warnings and suggestions as advice.
```

You see none of this unless you look. The agent sees the message and, in most cases, fixes the file.

## Install

You need three things:

- `node` 18 or newer. The plugin has no npm dependencies.
- `vale` on your PATH: `brew install vale`, or another installer from [vale.sh](https://vale.sh). ⚠️ A different tool, an STE linter, also installs a binary named `vale`. This plugin needs errata-ai vale, the one brew installs. If you have both, put errata-ai's first on PATH. Without `vale`, the rules still inject and the checks skip.
- Claude Code 2.1.85 or newer.

Install the plugin:

```
/plugin marketplace add ifandelse/just-say-so
/plugin install just-say-so@just-say-so
```

Then, in a project, set it up:

```
/just-say-so:init
```

It writes a `.vale.ini` that loads the JustSaySo rules when the project has none, runs `vale sync`, writes `.just-say-so.json` for any targets you named, wires a commit hook for the repo's hook tooling, and ends with the doctor report. Add `--dry-run` to see the steps without writing anything.

Check the setup at any time:

```
/just-say-so:doctor
```

A clean report ends with `No warnings.` and shows, per target, which rules are on:

```
Targets (the plugin's reading of the Vale config: rules on per style, then how many of those sit at each level)
  reply        reply.reply          JustSaySo 6 of 6 rules on · levels: 5 error, 1 suggestion
               sections: [*] [*.reply]
  files .md    doc.md               JustSaySo 6 of 6 rules on · levels: 5 error, 1 suggestion
               sections: [*]
```

Local development runs the plugin from a checkout: `claude --plugin-dir /path/to/just-say-so`.

## What it does

Three terms are used from here on, and each lives in one place:

- A **target** is one kind of text the agent produces. There are three: the `files` it writes, the text it `publish`es through `gh`, MCP tools, and the Artifact tool, and its chat `reply`. The three targets are the top-level keys of the plugin's config file, `.just-say-so.json`.
- A **mode** is what a target does with an error: `off`, `warn`, or `block`. It is the `mode` field under each target in that same file.
- A **bullet** is one line of the rules text. The rules text is rendered from [rules/manifest.json](rules/manifest.json). You can add bullets of your own in a JSON file of the same shape and name it under `rules.extra` in `.just-say-so.json`; those bullets join the shipped ones. A bullet either names the Vale rules that check it, in its `vale` field, or names none. A bullet with none is a **judgment rule**: the model follows it, and no linter checks it.

Which Vale rules run on which target is neither file's business. That is `.vale.ini`, next.

### Vale lints the prose

Every check runs Vale, so every check is markup-aware: code blocks and inline code never match a rule, and any style in Vale's ecosystem plugs in. Which rules apply to which target is Vale's job, in `.vale.ini`. Chat replies lint under the name `reply.reply`, published text under names such as `gh.pr.body.publish`, and files under their own paths, so one config narrows rules per target:

```ini
[*]
BasedOnStyles = JustSaySo, ai-tells

[*.reply]
ai-tells.ParagraphLength = NO
```

Severity is the policy. An `error` can block; a `warning` or `suggestion` is advice. Four of the shipped bullets ban things a pattern can match: the buzzwords, the filler frames, the "it's not x, it's y" shape, and the empty intensifiers. Those four are also generated as the Vale rules of the JustSaySo package, from the same manifest the rules text comes from, so the bullet and the rule that checks it never disagree.

The defaults, and what you see under each:

| Target    | Default                                                 | What happens                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`   | `warn`                                                  | After each write, the agent gets the alerts for the lines it added, as in the example above. `block` adds a gate at the end of the turn while errors remain.                                                   |
| `publish` | `block`, with `gh` and MCP off and the Artifact page on | Nothing checks a `gh pr comment` until you turn `publish.gh` on. Once on, a flagged call is denied before it runs, because nothing can un-publish.                                                             |
| `reply`   | `warn`                                                  | Each finished reply is linted and the error counts are kept. Nothing interrupts you. The counts ride the next rules injection as a short report (below). `block` makes the model rewrite before the turn ends; see the warning under [Settings people change first](#settings-people-change-first) before you use it. |

### Judgment rules

Earlier, judgment rules were described as one of the pillars in just-say-so. Where Vale lints based on patterns, judgment rules are about instructing the model with principles on _how_ to communicate. In other words, a judgment rule and a Vale rule are two different things. The judgment rules shipped with just-say-so come from the [ASD-STE100 standard](https://www.asd-ste100.org/) (Simplified Technical English), minus its 900-word dictionary, and you can swap in your own.

[rules/manifest.json](rules/manifest.json) holds the rules. Each bullet in it has a `full` text, a `short` text for most of them, and a `vale` list naming the Vale rules that check it, empty for a judgment rule. The build renders two documents from that file: [rules/full.md](rules/full.md), every bullet's full text with the Vale rules that check it, and [rules/condensed.md](rules/condensed.md), the short texts, called the condensed reminder. A test fails when either drifts from the manifest.

The full text goes out at every context start (startup, resume, `/clear`, and after compaction) and into every subagent when it spawns. The condensed reminder goes out on the prompt after a reply broke a rule, with the report of what broke, when `rules.onViolation` is on, which it is by default. `rules.contextStartText: "condensed"` sends the reminder at context start instead. `/just-say-so:rules` loads the full text by hand, and `/just-say-so:remind` the reminder. The reminder opens like this:

```
## Communication rules — reminder

Apply to all prose: chat, explanations, docs, reports, answers.

- Lead with the answer, decision, result, or required action.
- Use the correct technical term when it is the most accurate word. Never substitute a vaguer word for a precise one.
- One idea per sentence. Most sentences under 20 words.
...
```

Before it goes out, the plugin reads your Vale config and adjusts it: a bullet whose Vale rules you turned off is dropped, and error-level rules from your other styles that no bullet describes are named at the end. The model is told what your project enforces, in your project's terms.

In the default `reply: warn` mode, a reply that broke a rule costs you nothing at the time. On your next prompt, the reminder carries a report, and the model is told to apply it without mentioning it:

```
Recent replies broke these rules (rule, count, and the matched term when it is a fixed one):
  - JustSaySo.Buzzwords "robust" (1): Banned buzzword: 'robust'. Use a precise domain term or delete it.
  - JustSaySo.FillerFrames "It's important to note" (1): Banned filler frame: 'It's important to note'. Delete it and state the point directly.
Apply the rules to your next replies. Do not revise, repeat, or mention earlier replies, and do not acknowledge this note.
```

One distinction matters here. Vale can detect a banned word and, in `block` mode, refuse it. "Lead with the answer" is an instruction the model follows or fails to follow; no setting enforces it. The third pillar exists for those misses.

### You capture the misses

When a reply is bad in a way you noticed, reject it:

```
/just-say-so:restate #undefined-term what is a "pin"? the term was never defined
```

The model rewrites the reply under the rules. The plugin saves the rejected reply as the model wrote it, your reason, the `#tag`, the prompt that produced the reply, and the rewrite, as one line in `rejections.jsonl` under your state directory. Nothing leaves your machine, and nothing is written into the project. A tag is any `#word` you type; there is no list.

Those records are what the summary and the advice read. `/just-say-so:summary` prints facts with their counts: how often you reject, which Vale rules fired on the replies you rejected, which tags recur, and what each recurring tag points at. Once a tag has 3 rejections in one project, `/just-say-so:advise` turns it into a recommendation: a `.vale.ini` line, a judgment bullet in a file you own, or a Vale package to install. You apply the change yourself; the plugin edits no config on its own, and none of this changes the model.

## Already using Vale?

Vale is a command you run on files. It knows nothing about an agent, a turn, or a reply, and it forgets each run when it exits. just-say-so adds the parts that need a harness:

- **It runs Vale at the moments the harness offers, and feeds the result back into the model's context.** After a write, the agent gets the alerts for the lines it added. Before a `gh` or MCP call publishes text, the call is checked with the text in hand. At the end of a reply, the reply itself is linted. Vale on its own never reaches the model.
- **It enforces at the right moment for each target.** A file is gated at the end of the turn, when the agent can still fix it. A publish call is denied before it runs, because nothing can un-publish. A reply is counted and reported on the next prompt.
- **It carries the rules a linter cannot express.** "Lead with the answer" and "define a term on first use" are instructions, not patterns. just-say-so keeps them in the model's context across session starts, compaction, and subagents, and trims them to your Vale config: a bullet whose rules you turned off disappears, and error-level rules of yours that no bullet describes are named.
- **It remembers what you rejected.** Vale has no record of the reply you found bad. `/just-say-so:restate` keeps it, with your reason and tag, and the summary and advice turn those records into Vale tunes, judgment bullets, and package suggestions.

Your Vale setup stays the source of truth. The same `.vale.ini` drives your editor, your CI, the commit gate, and every check here. The JustSaySo rules are an ordinary Vale package, your vocabulary is Vale's `accept.txt`, and any style from Vale's ecosystem plugs in unchanged.

## Everyday commands

In the order you will meet them:

- `/just-say-so:restate [#tag] [reason]`: the previous reply broke the rules in a way you noticed. Rewrite it and record the miss. Tag it; the tag is how advice finds it later.
- `/just-say-so:allow <term>`: the checker flagged a word that is a real term in this project. The term goes into the project's Vale vocabulary and stops matching, in the session and at commit time. An entry is a case-sensitive regular expression, so allow each spelling you use.
- `/just-say-so:doctor`: how the plugin reads this project, with every warning and the fix for each. Run it when a check behaves in a way you did not expect.
- `/just-say-so:remind` and `/just-say-so:rules`: inject the condensed reminder now, or load the full rules for the rest of the session. Useful in a harness without hooks.
- `/just-say-so:summary [--since 30d] [--project <path>]`: the facts from the records, with their counts. It recommends nothing.
- `/just-say-so:advise [--since 30d] [--project <path>]`: one recommendation per recurring tag, with the counts it rests on and the change ready to paste. It names only rules and packages the plugin can see: the styles installed in the project, and the package cache.
- `/just-say-so:packages --refresh`: fills the package cache, about 3 MB of rule descriptions from the 25 writing-rule packages in the Vale registry, so advice can suggest rules from packages you do not have. Optional, and nothing downloads it on its own. The first `advise` tells you when it is empty.
- `/just-say-so:draft`: you added a Vale package and the reminder names its rules without explaining them. This drafts the bullets for you to edit and keep.

## Settings people change first

The plugin runs with no configuration. To change it, create `.just-say-so.json` in the project root, or `~/.config/just-say-so/just-say-so.json` for every project. Set only the fields you care about; a project file wins over the personal one. The two changes people make first:

```jsonc
{
  "files": { "mode": "block" }, // hold the turn while written files carry errors
  "publish": { "gh": true, "mcp": ["mcp__confluence__*"] } // check what goes out through gh and these MCP tools
}
```

⚠️ Leave `reply.mode` at `warn`. In `block` mode the Stop hook makes the model rewrite a flagged reply, but the harness has already printed the first version, so you read the original and the rewrite both, and a long session fills with pairs. In `warn` mode the counts ride your next prompt as a report, the model applies it without mentioning earlier replies, and you read each reply once. `block` is for single-prompt runs such as CI, where there is no next prompt.

And the shape of the whole file, with its defaults:

```jsonc
{
  "files": { "mode": "warn", "show": "suggestion" },
  "publish": {
    "mode": "block",
    "gh": false,
    "mcp": [],
    "artifact": true,
    "unresolved": "ask"
  },
  "reply": { "mode": "warn" },
  "rules": {
    "onContextStart": ["startup", "resume", "clear", "compact"],
    "contextStartText": "full",
    "onSubagentStart": true,
    "onViolation": true
  },
  "vale": { "config": null },
  "events": { "mode": "on" }
}
```

Every field, the layers, and the forced layer for CI are in the [configuration reference](docs/configuration.md).

## Tuning the rules

There are four places to change the rules, listed from the smallest change to the largest.

**Turn a rule off or change its level** in `.vale.ini`. A line in `[*]` applies to every target; a line in `[*.reply]` or `[*.publish]` narrows one. `JustSaySo.Intensifiers = NO` drops that rule; `ai-tells.EmDashUsage = error` makes a rule blocking. The reminder follows: a bullet whose rules are all off disappears from it.

**Allow a term** with `/just-say-so:allow`. It writes the term to the project's Vale vocabulary, the file `styles/config/vocabularies/Project/accept.txt`, which you can also edit by hand. The rules permit a buzzword "when it has precise meaning or is relevant to the domain"; whether a term qualifies is a fact about your project, so that fact lives in your project and not in the model's judgment.

**Add a Vale package.** Name it under `Packages` in `.vale.ini`, run `vale sync`, and add its style to `BasedOnStyles`. [ai-tells](https://github.com/tbhb/vale-ai-tells) flags the fingerprints of AI prose and pairs well with the shipped rules. The reminder names the new package's error-level rules at once; `/just-say-so:draft` writes bullets for them.

**Write your own bullets.** Put a file named `.just-say-so-rules.json` in the project root, in the same shape as the manifest, and its bullets join the shipped ones; no setting is needed, and `rules.extra` names a different path when you want one. A bullet with the `id` of a shipped bullet replaces it, so you can reword one; `{ "id": "headings-and-lists", "drop": true }` removes one. This is where a judgment rule for your project goes, and where `/draft` output lands. `rules.manifest` replaces the shipped rules outright. The shape, the `vale` field that ties a bullet to its rules, and the message overrides are in [the rules manifest](docs/rules.md).

Vale also decides which files get checked at all: a `[glob]` section with an empty `BasedOnStyles` exempts its paths. This repo's own [.vale.ini](.vale.ini) does that for the docs and tests that quote the banned words. The details of config resolution, lint names, and the package are in [the Vale engine](docs/vale.md).

## Outside a session

The hooks run only inside Claude Code. Text reaches a repository in other ways too, so the plugin ships a commit gate: `node src/cli/check-staged.js` lints the staged Markdown and HTML and exits 1 on an error-level alert in an added line. `/just-say-so:init` wires it for the pre-commit framework, Husky, or a plain git hook, and `--base main` runs the same check over a branch in CI. Single-prompt runs and pinning a plugin version in CI have their own notes. All of it is in [the commit gate, CI, and pinning](docs/commit-gate.md).

## Reference

- [Hooks](docs/hooks.md): what each hook does and when it runs.
- [Configuration reference](docs/configuration.md): every field, the layers, the forced layer.
- [The Vale engine](docs/vale.md): config resolution, lint names, narrowing per target, the JustSaySo package, the vocabulary.
- [Checking published text](docs/publish.md): the `gh`, MCP, and Artifact checks, unresolved values, and the known gaps.
- [What the plugin records, and the summary](docs/records.md): the two state files, what each line holds, and the definitions the summary's numbers rest on.
- [Advice](docs/advice.md): the situations a tag can land in, the shortlist, the registry, and the package cache.
- [The rules manifest](docs/rules.md): the manifest shape, drafting bullets, your own rules, your own messages.
- [The commit gate, CI, and pinning](docs/commit-gate.md).
- [Other harnesses](docs/harnesses.md): what Codex, Cursor, Copilot CLI, Gemini CLI, and OpenCode can carry, checked against their docs.
- [Upgrading](docs/upgrading.md): 0.17.0, and the 0.8.x and 0.9.x tables.
- [Limits](docs/limits.md).

## Development

Runtime code has zero dependencies and runs on Node 18 or newer. The test stack (vitest 5) needs Node 22.12 or newer.

```
npm test               # run the suite
npm run test:coverage  # enforces 100% line coverage on src/lib/**
npm run build          # render rules/full.md, rules/condensed.md, and the JustSaySo style from rules/manifest.json
```

Hook logic sits in `src/lib/hooks/` as pure `run(input, env)` functions; the scripts in `src/hooks/` are stdin shims around them. Test conventions live in [.ai/UnitTestGeneration.md](.ai/UnitTestGeneration.md).

Releases bump the version in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, tag it (`v0.16.0`), and attach `JustSaySo.zip` from `scripts/package-style.sh`. Within a minor series, import paths and function signatures under `src/lib/` do not change; before 1.0, a minor bump may change anything.

## License

MIT
