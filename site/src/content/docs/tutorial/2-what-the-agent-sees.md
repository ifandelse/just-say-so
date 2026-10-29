---
title: "2. What the agent sees"
description: "The rules text at context start, the full and condensed forms, and the report that follows a reply that broke a rule."
sidebar:
  order: 2
---

## Where you are

The plugin is installed, a project is set up with the defaults, and the agent has fixed one file.

## The rules at context start

Every context start injects the full rules text into the agent's context: a new session, a resume, `/clear`, and the rebuild after compaction. You never see it unless you ask. Run:

```
/just-say-so:rules
```

The text that appears is what the agent got. It opens with "Lead with the answer, decision, result, or required action." and names the Vale rules behind each bullet that has them. [The rules](/reference/the-rules/) is the same text on this site.

Before each injection the plugin reads your `.vale.ini` and trims the text. A bullet whose Vale rules you have turned off is left out. Error-level rules in your other styles that no bullet describes are named at the end. With the defaults nothing is trimmed, because every rule is on and only the shipped style is installed.

## The condensed reminder

The bullets also have a short form, the condensed reminder, about half the length. It goes out on the prompt after a reply broke a rule, with a report. See it with:

```
/just-say-so:remind
```

## Break a rule and read the report

Ask a question and, in your prompt, ask the agent to use the words `robust` and `seamless` in its answer. The reply goes out as written; nothing interrupts you. On your next prompt, whatever you type, the reminder goes out with this after it:

```
Recent replies broke these rules (rule, count, and the matched term when it is a fixed one):
  - JustSaySo.Buzzwords "robust" (1): Banned buzzword: 'robust'. Use a precise domain term or delete it.
  - JustSaySo.Buzzwords "seamless" (1): Banned buzzword: 'seamless'. Use a precise domain term or delete it.
Apply the rules to your next replies. Do not revise, repeat, or mention earlier replies, and do not acknowledge this note.
```

The model applies it and says nothing about it. That is `reply.mode: "warn"`, the default, and the tutorial keeps it. The `block` mode makes the model rewrite the reply before the turn ends, and you then read the original and the rewrite both, which is why [the configuration page](/configuration/reply/) reserves `block` for single-prompt runs.

## Check

The doctor's `rules` line reads `context start [startup, resume, clear, compact] as full text · subagents yes · on violation yes`.

## Next

[Your first restate](/tutorial/3-your-first-restate/): rejecting a reply the rules did not catch.
