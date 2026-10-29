---
title: "/just-say-so:summary"
description: "What the plugin has recorded, as facts with their counts: turns, rejections per 100 turns, the rules that fire, the tags, and what each recurring tag points at."
sidebar:
  order: 7
---

## What it does

Reads the two state files and prints facts with their counts. The window and its sessions; volume; rejections per 100 turns, overall, per project, and per week once the window spans a month; rejections in each distance bucket from the last rules injection; the rules with an error on final replies; the rules on rejected replies; rewrites; the reasons you typed; the tags, each with what covers it; what each recurring tag points at; allows; sessions per setting. It ends with observations and what the data does not establish. It recommends nothing; [advise](/commands/advise/) does.

## Synopsis

```
/just-say-so:summary [--since 30d] [--project <path>] [--json]
```

## Arguments

| Argument | Meaning |
| --- | --- |
| `--since` | An ISO date, or a span such as `30d` or `6w`. Default: all time. |
| `--project <path>` | Narrow to one project path. |
| `--json` | Print the object the text is rendered from. |

## What it reads and writes

Reads `events.jsonl` and `rejections.jsonl` in the state directory, and the rules file of each project in the report, to classify tags. Writes nothing.

## What it prints

The report. It prints rule names, shipped terms, counts, project paths, and your typed reasons. It never prints a prompt or a reply. A rate prints only when its denominator is in the window; otherwise the line says it is unavailable. The definitions behind every number are in [Records and the summary](/reference/records/).

## Example

```
Tags (what covers each: a judgment bullet, a Vale-backed bullet, or nothing yet)
  hedging: 3 · no bullet covers it yet
  end-with-fact: 3 · covered by a bullet backed by ai-tells.MicDrop, ai-tells.PointVerdict; those rules fired on 0 of 3 linted rejected replies

What the tags point at (per project; a tag needs 3 rejections; ship-time means the reply event, restate-time means /restate linting the old reply)
  /Users/you/proj · #hedging: 3 · uncovered: no bullet has this id. Points at a judgment bullet, or a Vale rule.
```
