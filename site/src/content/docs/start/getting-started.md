---
title: "Getting started"
description: "Install the plugin, set up a project, and see every pillar once, in about fifteen minutes."
sidebar:
  order: 2
---

This page installs just-say-so and runs one session. You will see a file check, the rules in the agent's context, a reply report, and a restate. It takes about fifteen minutes.

## Before you start

You need three things.

- `node` 18 or newer. The plugin has no npm dependencies.
- `vale` on your PATH: `brew install vale`, or another installer from [vale.sh](https://vale.sh). A different tool, an STE linter, also installs a binary named `vale`. This plugin needs errata-ai vale, the one brew installs. If you have both, put errata-ai's first on PATH.
- Claude Code 2.1.85 or newer.

Without `vale`, the rules still inject and the checks skip. Session start says so once.

## 1. Install the plugin

In Claude Code:

```
/plugin marketplace add ifandelse/just-say-so
/plugin install just-say-so@just-say-so
```

## 2. Set up a project

Open a project and run:

```
/just-say-so:init
```

The skill prompts you for the targets you want checked beyond the defaults, then runs the setup. It writes a `.vale.ini` that loads the JustSaySo package when the project has none, runs `vale sync`, writes `.just-say-so.json` for any target you named, wires a commit hook for the repo's hook tooling, and ends with the doctor report. Add `--dry-run` to see the steps without writing anything.

The package brings three styles: JustSaySo, generated from the rules text, and two community packages the plugin bundles, ai-tells and STE, with the settings the plugin chose for their rules. [What is just-say-so](/start/what-is-just-say-so/#where-the-two-kinds-of-rule-come-from) says where each comes from.

## 3. Check the setup

```
/just-say-so:doctor
```

A clean report ends with `No warnings.` and shows, per target, which rules are on:

```
Targets (the plugin's reading of the Vale config: rules on per style, then how many of those sit at each level)
  reply        reply.reply          JustSaySo 4 of 4 rules on · STE 7 of 12 rules on · ai-tells 128 of 137 rules on · levels: 128 error, 4 warning, 7 suggestion
               sections: [*] [{*.md,*.mdx,*.markdown,*.txt,*.rst,*.adoc,*.asciidoc,*.html,*.htm,*.reply,*.publish}]
  files .md    doc.md               JustSaySo 4 of 4 rules on · STE 7 of 12 rules on · ai-tells 128 of 137 rules on · levels: 128 error, 4 warning, 7 suggestion
               sections: [*] [{*.md,*.mdx,*.markdown,*.txt,*.rst,*.adoc,*.asciidoc,*.html,*.htm,*.reply,*.publish}]
```

Each warning names its fix. Read them before going on.

## 4. Start a session and watch the rules arrive

Start a new session in the project. The rules text goes out at every context start. You do not see it, but the agent does. To see it yourself, run:

```
/just-say-so:rules
```

That loads the full text into the conversation, as the manifest renders it. The hooks inject the same text with one adjustment: they leave out a bullet whose Vale rules your project turned off. On a fresh setup nothing is turned off, so the two match. It opens with "Lead with the answer, decision, result, or required action."

## 5. Write a file and read the check

Ask the agent to write a short Markdown file that includes buzzwords such as `robust` or `seamless`. When the write is done, the agent gets a report of every alert on the lines it added, and in the default `warn` mode it is told to fix the errors before finishing. You see the fixed file. To see the report, ask the agent what the check said.

## 6. Reject a reply

Ask a question, and when the reply is bad in a way you noticed, reject it:

```
/just-say-so:restate #undefined-term what is a "pin"? the term was never defined
```

The model rewrites the reply under the rules. The plugin saves the rejected reply as the model wrote it, your reason, the tag, and the rewrite, as one line in a file under your state directory. The file stays on your machine. A tag is any `#word` you type.

## 7. Read the summary

```
/just-say-so:summary
```

It prints facts with their counts: turns, rejections per 100 turns, the rules that matched, the tags and what each points at. After one session most lines read zero. The numbers mean something after a week.

## What you have now

The agent writes under your rules, the files it writes are checked, and the misses you notice are on record. From here:

- [From the ground up](/tutorial/1-install-and-the-first-file-check/) continues this path step by step, through blocking, publishing, packages, and your own bullets.
- [Commands](/commands/) is one page per skill.
- [Configuration](/configuration/) is every setting.
