---
title: "The rules text"
description: "The manifest, its two renderings, and when each goes out."
sidebar:
  order: 2
---

The rules live in one file, `rules/manifest.json`. Each bullet in it has a `full` text, usually a `short` text, and a `vale` list naming the Vale rules that check it. The build renders two documents from that file and the JustSaySo Vale style from the same bullets, and a test fails when any of the three drifts from the manifest. A bullet about banned buzzwords and the Vale rule that flags them cannot disagree, because they are one record.

The **full text** is every bullet with its examples and the names of the rules that check it, about 600 words. The **condensed reminder** is the short texts, about 330 words. Shipped bullets with no short text, three at present, exist in the full text only.

The full text goes out at every context start, which is a new session, a resume, `/clear`, and the rebuild after compaction, and into every subagent when it spawns. That is the moment that matters most, and the full text adds only a few hundred tokens, so it is the default there. The condensed reminder goes out on the prompt after a reply broke a rule, with the report of what broke, where brevity helps and the full text was injected not long before.

Before any injection the plugin reads the project's Vale config for the reply target. A bullet whose Vale rules are all turned off is left out: a project that set `JustSaySo.Intensifiers = NO` gets a reminder without the intensifiers bullet. Error-level rules in the project's styles that no bullet describes are named at the end, twelve at most, so the model at least knows their names. A style that is installed in the styles directory but selected nowhere says nothing either way. The doctor prints this reading next to the raw config so the two can be checked against each other.
