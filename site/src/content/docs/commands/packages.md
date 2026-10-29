---
title: "/just-say-so:packages"
description: "Report or fill the package cache: the rule facts of every writing-rule package in the Vale registry, for advice on packages you do not have."
sidebar:
  order: 9
---

## What it does

Manages the package cache. With no arguments it reports the cache against the registry: which packages are cached, their dates and rule counts, which registry entries are missing. `--refresh` downloads every writing-rule package in the Vale registry, or the ones named, reads each rule's id, level, what it extends, message, link, and a sample of its tokens, and writes one JSON file per package. `--prune` removes cached packages the registry no longer lists. Nothing else ever downloads an archive.

## Synopsis

```
/just-say-so:packages [--refresh [Name ...]] [--prune] [--json]
```

## Arguments

| Argument | Meaning |
| --- | --- |
| `--refresh` | Download and cache every style package, about 3 MB from the packages' GitHub release pages. |
| `--refresh Name Other` | Only those packages. |
| `--prune` | Remove cached packages the registry dropped. |
| `--json` | Print the status object. |

## What it reads and writes

Reads the registry list. Writes `packages/<Name>.json` files under the state directory. An archive is read in memory; only its `.yml` entries are looked at, and nothing from it is written out or run. A failed download keeps the package's previous file.

## What it prints

One line per refreshed or failed package, then the status report. The script exits 1 when a download failed.

## Example

```
refreshed ai-tells: 137 rules
refreshed alex: 11 rules
just-say-so package cache: /Users/you/.local/state/just-say-so/packages
  registry: live
  25 packages · 1395 rules · fetched 2026-10-27T23:12:30.021Z
```
