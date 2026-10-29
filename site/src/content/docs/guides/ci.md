---
title: "Run the gate in CI, and pin a version"
description: "Lint everything a branch added since main, and pin the plugin version a pipeline installs."
sidebar:
  order: 9
---

**Goal.** A pull request fails its check when a branch added an error-level alert to Markdown or HTML, and the pipeline installs a known plugin version.

**Precondition.** `vale` installed in the job, and the repo as a dev dependency from a tag.

## Steps

1. In the job, after `npm ci` and a Vale install:

   ```
   node node_modules/just-say-so/src/cli/check-staged.js --base main
   ```

   `--base` lints the working tree against the diff from `main`, so only added lines count. Exit 0 is clean or warnings only, 1 is an error on an added line, 2 is a `git` or `vale` failure, which the gate refuses to pass.

2. For a Claude Code job that uses the plugin itself, commit a config for CI and point the forced layer at it:

   ```yaml
   env:
     JUST_SAY_SO_FORCE_CONFIG: ${{ github.workspace }}/.github/just-say-so.ci.json
   ```

   Fields the forced file sets win over the project file, so a mode committed to `.just-say-so.json` can never weaken the CI policy.

## Pinning the plugin

`anthropics/claude-code-action` installs plugins from a marketplace URL or a directory path, and neither carries a tag. To pin, vendor the plugin: copy `.claude-plugin/`, `hooks/`, `rules/`, `skills/`, and `src/` from a tagged release into the repository and point `plugin_marketplaces` at that directory. The copy needs no install step. [The commit gate, CI, and pinning](/reference/commit-gate/) has the full note.
