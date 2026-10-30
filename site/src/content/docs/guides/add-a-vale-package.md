---
title: "Add a Vale package"
description: "Install a style from the Vale registry, select it for the targets you want, and get bullets for its rules."
sidebar:
  order: 5
---

**Goal.** The project runs a Vale package beside the bundled styles, and the reminder describes its rules instead of naming them.

**Precondition.** The project has a `.vale.ini` with `StylesPath`.

## Steps

1. Add the package to `Packages`, and add its style to `BasedOnStyles` in a section for the targets you want, restating the bundled styles. The reminder and `/just-say-so:draft` read the `reply.reply` target, so include `*.reply` when you want them to see the package:

   ```ini
   Packages = https://github.com/ifandelse/just-say-so/releases/download/v0.19.0/JustSaySo.zip, Google

   [{*.md,*.reply}]
   BasedOnStyles = JustSaySo, ai-tells, STE, Google
   ```

   A bare name resolves through the Vale registry, and a release URL pins a version. A `BasedOnStyles` line in a section starts from its own list, so a section that leaves out ai-tells and STE drops them for that format.

2. Run `vale sync`.

3. Run `/just-say-so:draft`, read the bullets it writes, edit them, and save the file as `.just-say-so-rules.json` in the project root. Until then the reminder names the package's error-level rules at the end, twelve at most, and describes none of them.

4. Confirm with the doctor: the targets show the new style with its rule count, and the `extra rules` line names your file.

## Choosing a package

`/just-say-so:advise` lists the registry packages a project does not have, with their descriptions, and after `/just-say-so:packages --refresh` it can match your rejection tags against their rules. Vale's own [package explorer](https://vale.sh/explorer) is the browsable list. ai-tells and STE are already bundled, so adding them again only moves the pin.
