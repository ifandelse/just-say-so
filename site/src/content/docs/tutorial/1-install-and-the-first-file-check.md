---
title: "1. Install and the first file check"
description: "Install the plugin, set up a project with the defaults, and read the first file check."
sidebar:
  order: 1
---

## Where you are

A project with Markdown in it, Claude Code, and nothing from just-say-so yet.

## Install

```
/plugin marketplace add ifandelse/just-say-so
/plugin install just-say-so@just-say-so
```

Install `vale` if it is not on your PATH: `brew install vale`, or another installer from [vale.sh](https://vale.sh). This plugin needs errata-ai vale, the one brew installs; an STE linter also installs a binary named `vale`, and if you have both, errata-ai's must come first on PATH.

## Set the project up with the defaults

In the project, run `/just-say-so:init`. At the prompt for which targets to check, answer that the defaults are fine. It writes a `.vale.ini` that loads the JustSaySo package, runs `vale sync`, and prints the doctor report. It writes no `.just-say-so.json`, because the defaults need none.

The defaults are written files on `warn`, replies on `warn`, and publishing on `block` with the Artifact page checked and the `gh` and MCP sources off.

## Write a file

Start a new session. Ask the agent to write a short rollout note as a Markdown file, and ask it to open with a sentence that uses the words `leverage` and `streamline`. After the write, the agent gets this:

```
just-say-so: Vale reports 2 error(s), 0 warning(s), 0 suggestion(s) in notes.md (whole file — this write created or replaced it):
  - L3 error ai-tells.OverusedVocabularyVerbs: AI vocabulary (verb form): 'leverage'. Replace with a direct verb. ["leverage"]
  - L3 error ai-tells.OverusedVocabulary: AI vocabulary: 'streamline'. Replace with a more specific or common word. ["streamline"]
Fix the errors before finishing. Treat warnings and suggestions as advice.
```

You do not see that message. The agent does, and in most cases it edits the file before the turn ends. Open the file and read the sentence it wrote instead. In `warn` mode the write stands and the turn can end with an error still in the file. Chapter 4 changes that.

## Check

```
/just-say-so:doctor
```

The `targets` line reads `files warn (show suggestion) · publish block, artifact · reply warn`, and the `files .md` target shows `JustSaySo 4 of 4 rules on · STE 7 of 12 rules on · ai-tells 128 of 137 rules on`. The doctor prints no warnings.

## Next

Chapter 2, [What the agent sees](/tutorial/2-what-the-agent-sees/), covers the rules in the agent's context and the report that follows a reply.
