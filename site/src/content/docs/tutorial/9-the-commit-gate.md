---
title: "9. Put the commit gate on the repo"
description: "Lint staged Markdown at commit time with the same .vale.ini, and run the same check in CI."
sidebar:
  order: 9
---

## Where you are

Every check so far runs inside a Claude Code session. A teammate commits by hand, an agent writes a file through a shell command, or a pipeline generates one, and none of those pass through a hook.

## Wire the gate

```
/just-say-so:init --hook auto
```

`auto` picks the pre-commit framework when `.pre-commit-config.yaml` exists, Husky when `.husky/` exists, and a plain `.git/hooks/pre-commit` when the repo has a `package.json`. Otherwise it prints the pre-commit snippet to add. When a step needs a command only you can run, `pre-commit install` say, the skill repeats it at the end.

The gate is `node src/cli/check-staged.js` from the plugin, pinned at a tag. It lints the staged Markdown and HTML, only the lines the commit adds, under the nearest `.vale.ini`, and exits 1 on an error-level alert. A term you allowed in a session is allowed here too, because both read the same vocabulary.

## See it fire

Stage a Markdown file with a buzzword on a new line and commit. The gate prints the alerts and refuses. Fix the line, or for one commit, `JUST_SAY_SO_PRECOMMIT=0 git commit`.

## Run it in CI

The same script with `--base main` lints everything a branch added since `main`:

```
node node_modules/just-say-so/src/cli/check-staged.js --base main
```

Exit codes: 0 clean or warnings only, 1 an error on an added line, 2 `git` or `vale` failed so the check could not be trusted. [The commit gate, CI, and pinning](/reference/commit-gate/) has the install routes and the pinning note.

## Check

Run the gate by hand with nothing staged: it prints that there is nothing to check and exits 0. Then `git log -1 --format=%s` after a clean commit shows your message, which means the hook ran and passed.

## Where you are now

The agent writes under your rules, with your bullets and your packages. Files and published text are gated. Your rejections are on record, the summary reads them, and advice turns them into changes. The repo enforces the same rules for everyone who commits. From here the [how-to guides](/guides/) cover one task at a time, and [Concepts](/concepts/) explain why the pieces work the way they do.
