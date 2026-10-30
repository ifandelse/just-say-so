---
title: "How the reminder adapts to your Vale config"
description: "The plugin reads vale ls-config and applies Vale's own precedence rules to decide what the reminder says."
sidebar:
  order: 6
---

The reminder the model gets is derived from your Vale config at every injection, not fixed. To do that, the plugin has to know which rules are on for the reply target, and Vale's config resolution has rules of its own.

The plugin runs `vale ls-config`, which prints the resolved configuration, and reads the styles directory for the rules each style declares. Then it applies Vale's precedence, measured against Vale 3.24 in a 36-case test that runs the real binary. Sections apply in file order. A `BasedOnStyles` line replaces the list before it, an empty one included. A per-rule setting in a section overrides a style-wide setting in the same section, and both override `[*]`. A style-wide `YES` never selects a style, only `BasedOnStyles` does. A per-rule `YES` runs a rule outright. `ls-config` loses the order of sections, and the plugin reads the section headers from the config files themselves.

From that reading it decides, per bullet: is every Vale rule this bullet names turned off? If so, and the config addressed those rules at all, the bullet is left out. A rule from a style that is not installed, or installed but selected nowhere, is unaddressed and says nothing. Then it collects the error-level rules that are on and that no bullet names, and appends their names.

The reading is the plugin's interpretation. The doctor prints it per target next to the raw section settings in the order Vale applies them, so when the two disagree you can see which one is wrong. The integration test against the real Vale binary is the tripwire for a Vale release that changes the rules.
