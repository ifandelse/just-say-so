---
title: "Run the commit gate with pre-commit, Husky, or a plain hook"
description: "Lint staged Markdown and HTML at commit time with the project's .vale.ini."
sidebar:
  order: 8
---

**Goal.** The gate refuses a commit that adds a line with an error-level alert. It applies to everyone who commits, agent or not.

**Precondition.** `vale` on the committer's PATH. When it is missing, the gate prints a notice and exits 0, so adding the gate never blocks a commit on a machine without Vale.

## Steps

1. Run `/just-say-so:init --hook auto` in the repo. It picks the pre-commit framework when `.pre-commit-config.yaml` exists, Husky when `.husky/` exists, and a plain `.git/hooks/pre-commit` when the repo has a `package.json`. Or pick with `--hook pre-commit`, `husky`, or `git`.

2. Run the command the skill repeats at the end, `pre-commit install` or a dev dependency install.

3. Stage a Markdown file with a banned word on a new line and commit. The gate prints the alerts and refuses.

## By hand

The pre-commit framework, pinned at a tag:

```yaml
repos:
  - repo: https://github.com/ifandelse/just-say-so
    rev: v0.19.0
    hooks:
      - id: vale-staged
```

Husky or a plain hook, with the repo as a dev dependency from a tag, then `node_modules/.bin/just-say-so-staged` in the hook. Do not point a hook at the Claude plugin cache. Its path is machine-specific and version-suffixed.

## Skipping once

`JUST_SAY_SO_PRECOMMIT=0 git commit ...` skips the gate for one commit. Exit codes and what the gate checks are in [The commit gate, CI, and pinning](/reference/commit-gate/).
