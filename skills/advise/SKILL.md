---
name: advise
description: Turn the recurring restate tags into recommendations — a Vale setting to change, a judgment bullet to write, or a package to install — from the summary's situations, the project's installed rules, and the package cache.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/advise.js" *)
---

The user wants advice on what their rejections point at. Arguments given, if any: $ARGUMENTS (`--since 30d`, `--since 2026-10-01`, `--project <path>`, `--json` pass through).

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/advise.js" $ARGUMENTS
```

Show the output verbatim in a code block, the package cache line included. If it says there is nothing to advise on, stop after one sentence.

Then write the advice. One recommendation per situation, in this shape: the project and tag, the counts it rests on copied from the output, what to change, and the change itself ready to paste. The change is one of:

- A `.vale.ini` line for the project's config: a per-rule level such as `ai-tells.MicDrop = error`, a rule turned on with `= YES`, or `reply.mode = block` in `.just-say-so.json` when the situation is "matched at ship-time and the reply still went out".
- A `rules.extra` bullet in the shape `/just-say-so:draft` produces, with `id` equal to the tag, a `full` text, a `short` text, and `vale` listing the rule ids it is backed by, or an empty list for a judgment bullet.
- A package to install: the `Packages = Name` line, `vale sync`, and the `BasedOnStyles` line for the reply section written as the project's current list plus the new style, never a replacement.

Rules for the writing:

- Name only rules and packages the output printed: a rule the bullet names, a shortlist candidate, or a registry package in the list. Never a rule from memory.
- A candidate's score is word overlap with the tag and its reasons. Read the candidate's message and say whether it checks the thing the reasons describe; a high score with the wrong meaning is no match. An empty candidate list means this search found nothing, not that no rule exists.
- An installed rule that is off, or sits below error, is advised as "turn on" or "raise", not as "tune".
- A package suggestion from a description alone is a category hint; say so, and name `/just-say-so:packages --refresh` when the cache is empty.
- For "not enough linted evidence", say what is missing and recommend nothing else.
- For a waived situation, blocking and the level were already in force; recommend a change to the rule's terms or message, or a bullet the model can act on, never a setting.
- Use the typed reasons printed per tag as the complaint to match against: a candidate counts when its message checks what those reasons describe.
- Follow the communication rules in force: lead with the change, one idea per sentence, no banned terms. Do not write any file.

End with the GitHub topic link from the output as the place to look for packages outside the registry.
