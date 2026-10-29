---
title: "The evidence rules behind the situations"
description: "Why the summary refuses to diagnose a tag without enough linted evidence, and what each situation rests on."
sidebar:
  order: 7
---

A tag with three or more rejections in one project lands in one situation. The rules that decide which one are strict, because a wrong diagnosis would send you to change a setting that was not the problem.

Two kinds of alert count, and the summary labels them. **Restate-time** alerts come from `/restate` linting the old reply under the config in force then. They show whether the rules detect the problem. **Ship-time** alerts come from the reply event the rejection joined to, the one logged when the reply ended. They show what happened when the reply went out. Detection claims use the first; enforcement claims use the second.

The order of decision:

1. **Uncovered**: no bullet has the tag as its id. Points at a judgment bullet or a Vale rule.
2. **Judgment**: a bullet with no Vale rules covers it. The line says whether the bullet has a short text, since only bullets with one are in the condensed reminder, and only a Vale alert re-injects the rules.
3. **Insufficient**: a Vale-backed bullet, but fewer than three linted rejected replies, or no joined reply that was linted. The line gives the counts and no diagnosis.
4. **Fired, still shipped**: the rules fired at ship-time and the reply went out. The line names the reply mode and levels in force. Points at `reply.mode = block` or the rule at error level.
5. **Stood down**: every ship-time fire was the reply gate standing down, which only happens under `block` with an error-level hit after a rewrite kept the same alerts. Blocking was in force, so the line points at the rule or the bullet, not at a setting. A stand-down under `warn`, or on a warning-level hit, is the file gate's and counts as shipped.
6. **Silent**: the rules caught fewer than half of the linted rejected replies at restate-time and none at ship-time. Points at a Vale tune.
7. **Detects now**: the rules catch half or more at restate-time and fired on none at ship-time, where at least one ship-time event carried no alert at all. The rules were off or lower then.

One subtlety decides between the last two and the third. The reply event folds overlapping alerts to one, preferring the shipped style, so a tagged rule absent from an event that carries other alerts may have fired on a span another style also flagged. Such an event is ambiguous. It never counts as proof the rule was silent, and a tag whose ship-time events are all ambiguous prints as insufficient.
