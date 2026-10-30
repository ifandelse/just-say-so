---
title: "Fill the package cache for advice"
description: "Download the registry's writing-rule packages once so advise can suggest rules you do not have."
sidebar:
  order: 11
---

**Goal.** `/just-say-so:advise` matches your rejection tags against the rules of every package in the Vale registry, not only the ones installed in the project.

**Precondition.** Network access to GitHub release pages, about 3 MB.

## Steps

1. Run:

   ```
   /just-say-so:packages --refresh
   ```

   It downloads the 25 writing-rule packages, reads each rule's id, level, message, and a sample of its tokens, and writes one file per package under `packages/` in the state directory. The refresh is the only step that downloads an archive. The script reads the archives in memory and does not run or write them out.

2. Run `/just-say-so:advise`. Its first line now reports the cache size and date instead of saying it is empty.

## Refreshing the cache

The cache is as old as the last refresh. Advise says so when the oldest package is over 30 days old. `/just-say-so:packages` alone reports the cache against the registry. `--refresh Name` refreshes one package. `--prune` removes packages the registry dropped.
