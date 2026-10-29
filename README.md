# just-say-so

Are you frustrated with how agents talk to you, and with the text they produce in Markdown files, pull requests, and other artifacts? You are not alone. `just-say-so` is a Claude Code plugin that pulls together the tools I use to solve this problem. It has three pillars:

- **Proactive communication rules.** "Lead with the answer" is an instruction the model follows, not a pattern Vale can match. The plugin injects those rules at every context start, into every subagent, and again after a reply broke one.
- **Linting of generated text.** [Vale](https://vale.sh) is a prose linter. The plugin runs it on the files the agent writes, on the text it publishes, and on each chat reply, under rules you control in `.vale.ini`.
- **Guided self-improvement.** `/just-say-so:restate` has the model rewrite a bad reply and records the miss with a tag. The records build into a summary, and the summary into advice.

Status: pre-1.0. Minor versions change behavior; see [Upgrading](https://just-say-so.com/reference/upgrading/).

## Already using Vale?

Vale is a command you run on files, and it forgets each run when it exits. just-say-so runs it at the moments the harness offers, feeds the alerts back into the model's context, enforces at the right moment for each kind of text, carries the rules a linter cannot express, and keeps a record of the replies you rejected. Your `.vale.ini` stays the source of truth for which rules run. [If you already use Vale](https://just-say-so.com/start/if-you-already-use-vale/) has the detail.

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

## Documentation

The site at [just-say-so.com](https://just-say-so.com) holds everything past the install.

- [Getting started](https://just-say-so.com/start/getting-started/): one session in about fifteen minutes.
- [From the ground up](https://just-say-so.com/tutorial/): a nine-chapter tutorial from the first file check to the commit gate.
- [How-to guides](https://just-say-so.com/guides/): one task each, from blocking files but not replies to running the gate in CI.
- [Commands](https://just-say-so.com/commands/): one page per skill.
- [Configuration](https://just-say-so.com/configuration/): every setting, the config layers, `.vale.ini` as the plugin reads it, the rules manifest and the extra file.
- [Concepts](https://just-say-so.com/concepts/): why the pieces work the way they do.
- [Reference](https://just-say-so.com/reference/the-rules/): the rules, hooks, the publish check, records and the summary, advice, the commit gate, other harnesses, upgrading, limits. The source for those pages is [docs/](docs/) in this repository.

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
