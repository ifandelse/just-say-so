---
title: "Add a Vale package"
description: "Install a style from the Vale registry, select it for the targets you want, and get bullets for its rules."
sidebar:
  order: 5
---

**Goal.** The project runs a Vale package beside the shipped rules, and the reminder describes its rules instead of naming them.

**Precondition.** The project has a `.vale.ini` with `StylesPath`.

## Steps

1. Add the package to `Packages` and its style to `BasedOnStyles` in `.vale.ini`:

   ```ini
   Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.18.1/JustSaySo.zip, ai-tells

   [*]
   BasedOnStyles = JustSaySo, ai-tells
   ```

   A bare name resolves through the Vale registry; a release URL pins a version.

2. Run `vale sync`.

3. Run `/just-say-so:draft`, read the bullets it writes, edit them, and save the file as `.just-say-so-rules.json` in the project root. Until then the reminder names the package's error-level rules at the end, twelve at most, and describes none of them.

4. Confirm with the doctor: the targets show the new style with its rule count, and the `extra rules` line names your file.

## Choosing a package

`/just-say-so:advise` lists the registry packages a project does not have, with their descriptions, and after `/just-say-so:packages --refresh` it can match your rejection tags against their rules. Vale's own [package explorer](https://vale.sh/explorer) is the browsable list.
