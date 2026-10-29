---
title: "5. Check what goes out through gh"
description: "Turn on the gh check and watch a flagged pull request comment get denied before it posts."
sidebar:
  order: 5
---

## Where you are

Written files are gated. Text the agent publishes through `gh` is not checked, because the `gh` source is off by default.

## Turn the gh source on

Edit `.just-say-so.json`:

```json
{
  "files": { "mode": "block" },
  "publish": { "gh": true }
}
```

`publish.mode` is already `block`. It was `block` all along, with only the Artifact page as a source; this adds the `gh` commands that publish prose: `create`, `comment`, `edit`, and `review` under `gh pr`, `gh issue`, and `gh release`, plus `gh api` calls that write a prose field.

## See a call denied

In a repository with an open pull request, ask the agent to comment on it with a sentence that uses the words `seamless` and `game-changing`. Before the command runs, the hook extracts the comment body, lints it as `gh.pr.comment.publish`, and denies the call:

```
just-say-so: Vale alerts in text published by gh pr comment:
  - error JustSaySo.Buzzwords: Banned buzzword: 'seamless'. Use a precise domain term or delete it. ["seamless"]
  - error JustSaySo.Buzzwords: Banned buzzword: 'game-changing'. Use a precise domain term or delete it. ["game-changing"]
Rewrite the flagged text per the communication rules, then retry the tool call.
```

GitHub never receives the comment. The agent rewrites and retries. This is the one place the plugin blocks before an action instead of at the end of the turn, because nothing can un-publish.

## A value the checker cannot read

Ask the agent to post a comment whose body comes from a shell substitution, `--body "$(cat notes.md)"`. The checker refuses to guess what the shell will produce. With `publish.unresolved` at its default, `ask`, you get a confirmation prompt that names the construct. Put the text in a flag value or a file instead.

## Check

The doctor's `targets` line reads `publish block, gh, artifact`, and the `publish` target shows `gh.pr.body.publish` with `JustSaySo 6 of 6 rules on`.

## Next

[Add a Vale package and draft its bullets](/tutorial/6-add-a-vale-package/): rules the shipped set does not have.
