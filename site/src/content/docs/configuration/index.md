---
title: "The config file and its layers"
description: "Where the plugin's settings live, how the layers combine, and the defaults."
sidebar:
  order: 0
---

just-say-so runs with no configuration. To change it, create one or both of these files:

1. `~/.config/just-say-so/just-say-so.json`, your personal defaults, applied in every project. Set `JUST_SAY_SO_CONFIG` to read this layer from a different path.
2. `.just-say-so.json` in a project's root, settings for that one project. The plugin finds it by walking up from the working directory, so it also applies in a subdirectory.

Both files use the same shape, and each sets only the fields you care about. When the same field appears in both, the project file wins over the personal file, and the personal file wins over the built-in defaults. Sections combine field by field.

One more layer exists for pipelines: set `JUST_SAY_SO_FORCE_CONFIG` to a config file path, and that file's fields beat every other layer, project file included. The order is defaults, then personal, then project, then forced.

## The defaults

```jsonc
{
  "files": {
    "mode": "warn",        // "off" | "warn" | "block"
    "show": "suggestion"   // lowest alert level shown to the agent at edit time
  },
  "publish": {
    "mode": "block",       // "off" | "warn" | "block"
    "gh": false,           // check the gh commands that publish prose
    "mcp": [],             // MCP tool-name patterns to check
    "artifact": true,      // check the page the Artifact tool publishes
    "unresolved": "ask"    // a published value the checker cannot read: "ask" | "allow" | "deny"
  },
  "reply": {
    "mode": "warn"         // "off" | "warn" | "block"
  },
  "rules": {
    "onContextStart": ["startup", "resume", "clear", "compact"],
    "contextStartText": "full",   // "full" | "condensed"
    "onSubagentStart": true,
    "onViolation": true,
    "manifest": null,      // your own rules manifest, replacing the shipped one
    "extra": null,         // your extra rules file; null looks for .just-say-so-rules.json
    "messagesPath": null   // overrides the hook message strings
  },
  "vale": {
    "config": null         // an explicit .vale.ini path
  },
  "events": {
    "mode": "on"           // "on" | "off"
  }
}
```

Each top-level key has its own page: [files](/configuration/files/), [publish](/configuration/publish/), [reply](/configuration/reply/), [rules](/configuration/rules/), [vale and events](/configuration/vale-and-events/). Two more pages cover the files the plugin reads beside its own: [.vale.ini as the plugin reads it](/configuration/vale-ini/) and [the rules manifest and the extra file](/configuration/manifest-and-extra/).

## A guard on edits

When the model edits `.just-say-so.json`, a `.vale.ini`, a vocabulary `accept.txt`, or the personal config through the file tools, a hook asks you to confirm first. Changes to the policy stay yours.
