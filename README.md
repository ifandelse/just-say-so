# just-say-so

Communication rules for AI coding agents, packaged as a plugin. Models drift from style instructions as context grows — a rule stated once at session start loses force twenty turns later. just-say-so re-injects a condensed rule set on a configurable interval, gates tool output on a banned-term list, and re-loads the rules after compaction. The shipped rules target prose that is precise and readable ([rules/full.md](rules/full.md)); swap in your own rules with two config keys.

## What it does

Three mechanisms, all driven by hooks:

| Hook | Script | Behavior |
| --- | --- | --- |
| `UserPromptSubmit` | `remind.js` | Injects the condensed rules every N prompts (default 5) or every N tokens of context growth (default 4,000). Never blocks a prompt. |
| `PreToolUse` on `Write\|Edit\|MultiEdit\|NotebookEdit` | `check-banned.js` | Scans the text the model is adding for banned terms. Default: deny the call with the violation list, so the model rewrites before anything lands on disk. |
| `SessionStart` | `session-start.js` | Re-injects the condensed rules after compaction, when the model most likely lost them. |
| `Stop` (off by default) | `check-output.js` | Scans the final chat reply for banned terms. `block` forces a rewrite; `warn` queues a note for the next prompt. |

Two commands cover environments without hooks, and manual use anywhere:

- `/just-say-so:rules` — load the full rules into context for the rest of the session.
- `/just-say-so:remind` — inject the condensed reminder now.

## Install (Claude Code)

```
/plugin marketplace add ifandelse/just-say-so
/plugin install just-say-so@just-say-so
```

Local development:

```
claude --plugin-dir /path/to/just-say-so
```

Requires `node` (≥18) on your PATH. The plugin has zero npm dependencies.

## Configuration

Config merges in order: built-in defaults ← `~/.config/just-say-so/config.json` ← the nearest `.just-say-so.json` walking up from the working directory. Objects merge; arrays and scalars replace. Everything below is optional — the defaults are the values shown.

```jsonc
{
  "reminder": {
    "mode": "prompts",             // "prompts" | "tokens" | "off"
    "everyPrompts": 5,             // fire every N user prompts
    "everyTokens": 4000,           // or: fire after N tokens of context growth
    "onSessionStart": ["compact"]  // also inject on these SessionStart sources:
                                   // "startup", "resume", "clear", "compact"
  },
  "bannedCheck": {
    "mode": "block",               // "block" | "warn" | "off"
    "tools": ["Write", "Edit", "MultiEdit", "NotebookEdit"],
    "exclude": ["**/package*.json", "**/*.lock", "**/node_modules/**", "**/*.min.*"],
    "include": [],                 // when non-empty, only these paths get checked
    "disableWords": [],            // opt out of specific built-in terms
    "additions": {                 // extend the list
      "words": [],                 // "ninja" or { "term": "ninja", "hint": "..." }
      "phrases": [],
      "patterns": []               // { "regex": "...", "flags": "i", "label": "..." }
    }
  },
  "outputCheck": { "mode": "off" }, // Stop-hook chat check: "off" | "warn" | "block"
  "rules": {
    "fullPath": null,              // your own rules file, replaces rules/full.md
    "condensedPath": null          // replaces rules/condensed.md
  }
}
```

Glob notes: a pattern without a slash matches the file's basename anywhere (`*.md`). A pattern with a slash matches the absolute path, and also the path relative to the project (`docs/**`).

### Bring your own rules

The shipped rules are the default payload, not a requirement. Point `rules.fullPath` and `rules.condensedPath` at your own markdown, and edit the banned list through `disableWords` and `additions`. The hooks, commands, and config machinery stay the same.

### Term matching

Matching is case-insensitive with word boundaries that treat hyphens as part of the word — a banned word inside an identifier or dependency name does not match. Phrases tolerate hyphen/space variation both ways. Curly quotes normalize to straight before matching. Terms in `rules/banned.json` marked `contextual` carry a condition a matcher cannot judge (the intensifiers, banned "unless quantified"), so they report as advisories and never block on their own.

## Limits, stated plainly

- The checker cannot tell prose from code. A banned word in a string literal you asked for will trip it. Use `exclude`, `include`, or `disableWords` to carve out what you need.
- The hedging rule (may/might/could as padding) is not machine-checked. Those words are legitimate in most technical sentences; only the reminder text carries that rule.
- The interval reminder depends on the harness delivering `UserPromptSubmit` events. Subagent traffic does not count toward the prompt counter.
- This repo's own docs and tests name the banned words, so its `.just-say-so.json` excludes those paths. Expect the same in any repo that documents its style rules.

## Other harnesses

The Claude Code hook protocol — JSON on stdin, JSON on stdout, exit 2 blocks — became the de-facto convention across coding agents, so most of this plugin carries over with wiring changes only. [adapters/README.md](adapters/README.md) maps the current landscape and the adapter contract.

## Development

Runtime code has zero dependencies; the test stack (vitest) is dev-only.

```
npm test               # run the suite
npm run test:watch     # watch mode
npm run test:coverage  # enforces 100% line coverage on src/lib/**
```

Test conventions live in [.ai/UnitTestGeneration.md](.ai/UnitTestGeneration.md). Hook logic sits in `src/lib/hooks/` as pure `run(input, env)` functions; the scripts in `src/hooks/` are stdin shims around them, exercised by the integration tests.

## License

MIT
