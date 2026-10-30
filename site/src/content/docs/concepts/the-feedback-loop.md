---
title: "The feedback loop"
description: "Restate, summary, advise: how a rejection becomes a change to your setup."
sidebar:
  order: 4
---

The loop has three stages, and each one only states facts the stage before it recorded.

**Restate** records a miss. When a reply is bad in a way you noticed, `/just-say-so:restate #tag reason` has the model rewrite it and saves the rejected reply as the model wrote it, your reason and tag, the prompt that produced it, the Vale alerts on the rejected text, and the rewrite. The reason is kept whole, and the tag is an index over it. Restate writes the record to the state directory outside the project. The record stays on the machine.

**Summary** counts. It reads the records and the events log, where every hook writes rule names and counts, never prose. It prints rejections per 100 turns, which rules matched on rejected replies, which replies Vale passed clean, and the tags with what covers each. For a tag with three or more rejections in one project, it decides one situation by fixed rules: uncovered, judgment, matched and still shipped, waived, silent, detects now, or not enough evidence. It recommends nothing. The report defines each number it prints, and the rules for what counts as evidence are strict about what the data can and cannot show.

**Advise** proposes. It takes the situations, reads the effective state of every rule a bullet names, shortlists candidate rules from the styles installed in the project and from the package cache by word overlap with the tag and its reasons, and has the model write one recommendation per situation: a `.vale.ini` line, a bullet, or a package. The model names only rules and packages the script printed. You apply the change yourself.

The loop proposes configuration changes. It changes no config on its own, and none of it changes the model.
