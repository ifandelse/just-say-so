---
title: "/just-say-so:init"
description: "Set a project up: a .vale.ini with the JustSaySo package, vale sync, the plugin config for the targets you name, the commit gate, and the doctor report."
sidebar:
  order: 1
---

## What it does

Sets a project up in four steps and prints each one. It writes a `.vale.ini` when the project has none, with `StylesPath = styles`, `Vocab = Project` and an empty `accept.txt`, the JustSaySo package pinned at the plugin's version, and `[*] BasedOnStyles = JustSaySo`. When a `.vale.ini` exists, it pins the package and leaves the rest alone. It runs `vale sync`. It writes `.just-say-so.json` for the flags you gave, merged over an existing file. It wires the commit gate for the hook tooling the repo already has. The doctor report follows.

## Synopsis

```
/just-say-so:init [--files MODE] [--publish MODE] [--gh] [--mcp PATTERN]... [--reply MODE] [--hook auto|pre-commit|husky|git|none] [--dry-run]
```

## Arguments

| Argument | Meaning |
| --- | --- |
| `--files MODE`, `--publish MODE`, `--reply MODE` | `off`, `warn`, or `block` for that target. Omitted targets keep their defaults. |
| `--gh` | Check the `gh` commands that publish prose. |
| `--mcp PATTERN` | An MCP tool pattern to check, such as `mcp__atlassian__*`. Repeat for more. |
| `--hook auto\|pre-commit\|husky\|git\|none` | Which commit hook to wire. `auto`, the default, picks the pre-commit framework when `.pre-commit-config.yaml` exists, Husky when `.husky/` exists, a plain `.git/hooks/pre-commit` when the repo has a `package.json`, and otherwise prints the pre-commit snippet. |
| `--dry-run` | Print every step without writing. |

With no arguments, the skill asks one question first: which targets you want checked beyond the defaults, and whether the agent publishes through `gh` or an MCP tool.

## What it reads and writes

Reads the project root (the nearest `.git`), any existing `.vale.ini` and `.just-say-so.json`, and the repo's hook tooling. Writes `.vale.ini`, `styles/config/vocabularies/Project/accept.txt`, `.just-say-so.json`, and the hook file for the tooling it chose. Runs `vale sync`, which downloads the package into `styles/`.

## What it prints

One line per step, prefixed `just-say-so init:`, then the full doctor report. When a step needs a command only you can run, such as `pre-commit install` or a dev dependency install, the skill repeats that command on its own line at the end.

## Example

A bare repository, dry run:

```
just-say-so init: project root: /Users/you/proj (dry run, nothing written)
just-say-so init: would write /Users/you/proj/.vale.ini with the JustSaySo package, StylesPath = styles, and Vocab = Project
just-say-so init: would create /Users/you/proj/styles/config/vocabularies/Project/accept.txt
just-say-so init: would run vale sync
just-say-so init: no plugin settings given, so the defaults apply (files warn, publish block with no source, reply warn)
just-say-so init: commit gate: add this to .pre-commit-config.yaml (the file does not exist yet) and run pre-commit install:
just-say-so init:     repos:
just-say-so init:       - repo: https://github.com/ifandelse/just-say-so
just-say-so init:         rev: v0.19.0
just-say-so init:         hooks:
just-say-so init:           - id: vale-staged
```
