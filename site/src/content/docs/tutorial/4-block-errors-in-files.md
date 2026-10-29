---
title: "4. Block errors in files, keep replies on warn"
description: "Hold the turn while a written file carries an error, allow a domain term, and leave replies alone."
sidebar:
  order: 4
---

## Where you are

Everything is on the defaults. Files the agent writes are checked and the agent is told to fix them, but the turn can end with an error still in a file.

## Set files to block

Create `.just-say-so.json` in the project root:

```json
{ "files": { "mode": "block" } }
```

That is the whole file. Every other setting keeps its default. The reply target stays on `warn`, which this chapter leaves alone on purpose: blocking replies prints the original and the rewrite both in the console.

If you want this in every project, put the same JSON in `~/.config/just-say-so/just-say-so.json` instead. A project file wins over the personal one when both set a field.

## See the gate

Start a new session and ask for another file with a buzzword in it. The agent gets the same alerts as before, and the edit-time check records the error-level ones that sit on lines the edit added. Now, at the end of the turn, a gate re-lints those files. While any recorded error is still there, the turn is held and the agent is told to fix it. The turn ends when they are gone. An error on a line the agent never touched, in a file it opened to edit a different paragraph, was never recorded and does not hold the turn; the [commit gate](/tutorial/9-the-commit-gate/) is what catches those.

When a rewrite leaves the same alerts, the gate reports once, lets the turn end, and waives those alerts for the rest of the session. A stuck term never loops.

## Allow a term

Ask for a file about a `robust regression` test suite, which is a real term in statistics. The checker flags the first word. In block mode, the message the agent gets tells it to suggest the allow command to you, quoting the collocation. Run it yourself:

```
/just-say-so:allow "robust regression"
```

The term goes into `styles/config/vocabularies/Project/accept.txt`, and Vale exempts it in the session and at commit time. The entry is a case-sensitive regular expression, so allow each spelling you use, or edit the file and write `[Rr]obust regression`.

## Check

The doctor's `targets` line reads `files block (show suggestion) · publish block, artifact · reply warn`, and the `vocabulary` line reads `Project (1 accepted)`.

## Next

[Check what goes out through gh](/tutorial/5-check-what-goes-out-through-gh/): the one place the plugin blocks before an action.
