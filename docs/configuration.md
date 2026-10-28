# Configuration reference

`just-say-so` works with no configuration. Install it and the defaults shown below apply.

When you want different behavior, create one or both of these files:

1. `~/.config/just-say-so/just-say-so.json` — your personal defaults. These apply in every project. Set the `JUST_SAY_SO_CONFIG` environment variable to read this layer from a different path instead.
2. `.just-say-so.json` in a project's root — settings for that one project. `just-say-so` finds this file by walking up from the working directory, so it also applies when you work in a subdirectory.

Both files use the same JSON shape, and each one can set only the fields you care about. When the same field appears in more than one place, the project file wins over your personal file. Your personal file wins over the built-in defaults. Sections combine field by field. Lists and single values replace the whole default. No rule lives in these files. A rule in a personal file would make the harness disagree with the commit hook, so rules, levels, and exemptions live in `.vale.ini` only.

One more layer exists for pipelines: set `JUST_SAY_SO_FORCE_CONFIG` to a config file path, and that file's fields beat every other layer, project file included. Precedence belongs to the layer: defaults ← personal ← project ← forced. Where a file sits on disk never changes it. Use it when a run must guarantee its policy — see [Single-prompt runs (CI)](commit-gate.md#single-prompt-runs-ci).

```jsonc
{
  "files": {
    "mode": "warn", // "off" | "warn" | "block" — warn: edit-time facts only; block adds the Stop gate
    "show": "suggestion" // lowest alert level shown to the agent at edit time: "error" | "warning" | "suggestion"
  },
  "publish": {
    "mode": "block", // "off" | "warn" | "block" — nothing can un-publish, so block is the default
    "gh": false, // check the gh commands that publish prose (see [Checking published text](publish.md))
    "mcp": [], // MCP tool-name patterns to check, for example "mcp__confluence__*"
    "artifact": true, // check the page the Artifact tool publishes
    "unresolved": "ask" // a published value the checker cannot read: "ask" | "allow" | "deny"
    // ("ask" acts as "allow" under automatic-permission harness modes)
  },
  "reply": {
    "mode": "warn" // "off" | "warn" | "block" — warn: count broken rules per reply and report them
    // with the next rules injection; block: rewrite before the turn ends
  },
  "rules": {
    "onContextStart": ["startup", "resume", "clear", "compact"],
    "contextStartText": "full", // what a context start and a subagent start inject: "full" (every bullet with its
    // examples and the rules that check it) or "condensed" (the short texts); the prompt after a violation always
    // carries the condensed form with the report
    // inject at the start of every context; trim the list to inject on fewer sources
    // (for example ["compact"] if your CLAUDE.md already carries the rules at startup)
    "onSubagentStart": true, // brief each subagent at spawn, with the text contextStartText names
    "onViolation": true, // inject the rules plus the reply report on the prompt after a flagged reply;
    // false holds the report for the next context start
    "manifest": null, // your own rules manifest, replaces rules/manifest.json (see [The rules manifest](rules.md))
    "extra": null, // a manifest fragment that adds, replaces, or drops bullets; null looks for
    // .just-say-so-rules.json in the project root or above (see The rules manifest)
    "messagesPath": null // overrides hook message strings, per key (rules/messages.json)
  },
  "vale": {
    "config": null // explicit .vale.ini path; default: nearest above the checked file, else the shipped fallback
  },
  "events": {
    "mode": "on" // "on" | "off" — the events log (see [What the plugin records](records.md)); off writes nothing
  }
}
```

Vale decides which files get checked, in `.vale.ini`. A `[glob]` section with an empty `BasedOnStyles` exempts its paths. This repo's own [.vale.ini](../.vale.ini) does exactly that for the docs and tests that name the banned words.

## The reply check

⚠️ `block` is not recommended for interactive sessions. A Stop hook cannot retract text the harness has already printed, so the original reply and the rewrite both appear in the console. Use `block` in single-prompt runs, where no next prompt exists to carry the report.

`reply.mode: "warn"` is the quiet reply check, and the default. The Stop hook lints each finished reply and keeps the error-level alerts as per-rule counts in session state. It returns nothing to the harness. The next rules injection in the main session appends a report below the rules. With `rules.onViolation` on (the default) that injection is the next prompt: the model sees the rules and the report one prompt after the reply that broke them. With it off the counts wait for a resume or the post-compaction injection. The report has one line per rule with its count, capped at ten lines. A short fixed match such as a banned word appears on its line. A longer match is a span of the old reply, so that line names the rule alone, and two styles that flag the same span count once. An instruction follows it: apply the rules to the next replies and leave earlier replies alone. The counts reset on delivery. Subagent injections do not include the report. Use `block` when you want the flagged reply itself fixed.
