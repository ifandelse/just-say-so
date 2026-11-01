---
title: "vale and events"
description: "An explicit Vale config path, and the events log switch."
sidebar:
  order: 5
---

## vale.config

```jsonc
"vale": { "config": null }
```

An explicit path to the `.vale.ini` every check uses. The default, `null`, lets each check find its own: the nearest `.vale.ini` above the file being checked, the walk Vale itself does, and the shipped fallback when there is none. The fallback loads the JustSaySo style alone, which lets the plugin work in a project with no Vale setup. Set this when a project keeps its Vale config somewhere Vale's walk would not find, or when one config must cover files outside the project.

## events.mode

```jsonc
"events": { "mode": "on" }
```

`on`, the default, writes one line per countable thing a hook saw to `events.jsonl` in the state directory: sessions with their settings, rules injections, replies with their alerts folded to counts per rule, restates, allows. Rule names and counts only, never prose. The summary's rates come from this file. `off` writes nothing, and the log-only reply lint stops with it. The file is never pruned; a line is under 300 bytes, so a year of heavy use is a few megabytes.

[Records and the summary](/reference/records/) lists every event and its fields.
