---
title: "Run just-say-so in a single-prompt job"
description: "Settings for a run that submits one prompt and ends, where there is no next prompt to deliver a report."
sidebar:
  order: 10
---

**Goal.** A non-interactive run, `anthropics/claude-code-action` say, gets the rules and enforces them, without relying on a next prompt.

**Precondition.** A config for CI, applied through `JUST_SAY_SO_FORCE_CONFIG`.

## Steps

1. Commit `.github/just-say-so.ci.json`:

   ```json
   {
     "rules": { "onContextStart": ["startup"] },
     "files": { "mode": "block" },
     "reply": { "mode": "block" }
   }
   ```

2. Set `JUST_SAY_SO_FORCE_CONFIG` to that path in the job's environment.

## Why these settings

`reply.mode: "warn"` delivers nothing in a single-prompt run: its report rides the next prompt, and there is none. `block` makes the model rewrite before the turn ends, which is right here and wrong in an interactive session. `onContextStart: ["startup"]` injects the rules once, which is all one prompt needs. `files.mode: "block"` holds the turn until written files are clean, and files are where CI output goes.
