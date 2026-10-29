---
title: "/just-say-so:doctor"
description: "How the plugin reads this project: the Vale binary and config in force, which rules each target lints under, the raw section settings, and every warning with its fix."
sidebar:
  order: 2
---

## What it does

Prints the plugin's reading of the project. The setup facts first: the Vale binary, the config files in force, each target's mode, how the rules go out, the package cache, the Vale config and how it was found, packages, vocabulary, formats, and the extra rules file. Then one line per target with, for each style, how many of its rules are on and at which levels, then any rules of a selected style that are off. Then the raw section settings in the order Vale applies them, so you can check the reading against the config. Then the warnings, each naming its fix.

## Synopsis

```
/just-say-so:doctor
```

## Arguments

None.

## What it reads and writes

Reads the plugin config layers, the nearest `.vale.ini`, `vale ls-config`, the styles directory, the extra rules file, the package cache, and `hook-errors.jsonl` in the state directory. Writes nothing.

## What it prints

The report. The script exits 1 when there are warnings, so a script can gate on it. Warnings cover: a missing or wrong `vale` binary, 0.8.x keys in a config file, no `.vale.ini` above the directory, the package pinned at a different tag than the plugin, packages listed but not synced, a `Vocab` that names a missing vocabulary, the `reply` and `publish` formats not mapped, a leftover `chat.md` section, a section that restates `BasedOnStyles`, a path list naming files that no longer exist, the JustSaySo style installed but selected nowhere, a target in block mode with no error-level rule, an unreadable `rules.manifest` or extra file, a drop that matches no bullet, and hook failures in the last 7 days.

## Example

```
just-say-so doctor — plugin 0.18.1

Setup
  vale: 3.24.0 (errata-ai)
  plugin config: /Users/you/.config/just-say-so/just-say-so.json
  targets: files block (show suggestion) · publish block, artifact · reply warn
  rules: context start [startup, resume, clear, compact] as full text · subagents yes · on violation yes
  package cache: 25 packages, 1395 rules, fetched 2026-10-27T23:12:30.021Z
  vale config: /Users/you/proj/.vale.ini (nearest above cwd)
  packages: none
  vocabulary: none (/just-say-so:allow adds one)
  formats: reply = md, publish = md
  extra rules: none (.just-say-so-rules.json in the project root, or rules.extra, adds, replaces, or drops bullets)

Targets (the plugin's reading of the Vale config: rules on per style, then how many of those sit at each level)
  reply        reply.reply          JustSaySo 6 of 6 rules on · levels: 5 error, 1 suggestion
               sections: [*] [*.reply]

No warnings.
```
