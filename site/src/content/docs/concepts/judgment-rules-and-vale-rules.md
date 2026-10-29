---
title: "Judgment rules and Vale rules"
description: "What a linter can check, what only the model can follow, and why the plugin keeps both."
sidebar:
  order: 3
---

A Vale rule is a pattern. It can find a banned word, a filler frame, a sentence over twenty words, a paragraph over six sentences, a hedge stacked on a hedge. It cannot tell whether a reply led with the answer, whether a term was defined before it was used, or whether the last sentence of a paragraph is a fact or a flourish. Those are judgments.

The plugin keeps both kinds in one list of bullets. A bullet with Vale rules behind it is enforced twice: the text tells the model, and the linter checks. A bullet with none, a **judgment rule**, is enforced once, by the model's reading of it. The `vale` field on each bullet is the line between the two, and it is why the field matters beyond documentation: the reminder drops a bullet when its rules are off, and the summary knows whether a rejection tagged with a bullet's id was something Vale could have caught.

The two kinds fail differently. When a Vale-backed rule is broken, the hooks see it: the file check, the publish check, the reply report. When a judgment rule is broken, nothing sees it but you. That is what `/just-say-so:restate` is for. It records the misses the hooks cannot, and over time the records show which judgment rules need rewording, which need a short text so they reach the reminder, and which could be turned into Vale rules after all, because a package in the registry has one.

The shipped rules come from the ASD-STE100 standard for Simplified Technical English, minus its 900-word dictionary. Four of them ban things a pattern can match and are generated as the Vale rules of the JustSaySo package. The rest are judgment rules, and the plugin's value is that they stay in force across a long session instead of fading after the first prompt.
