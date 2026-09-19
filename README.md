# just-say-so

LLM-generated prose is not fit for human consumption. Agents simultaneously speak as if we hold multiple PhDs and drop into a verbal shorthand that feels like a mix between a bad movie trailer and a conversation you showed up late to. `just-say-so` packages the rules I've used to tackle this problem and makes them available as skills. But it also does something else: it fights attention decay. If you're using a coding harness (like Claude Code), you've already experienced this when the model forgets key things (like how to talk to you) and has to be reminded frequently. `just-say-so` plugs into your harness's hooks and can be configured to remind the agent either by turn count or token count, and to ensure the agent is reminded after compaction.

The `just-say-so` communication rules are adapted from the [ASD-STE100 standard](https://www.asd-ste100.org/) (Simplified Technical English), but they do not adhere to the 900-word-dictionary that ASD-STE100 is limited to.

## What it does

`just-say-so` gets integrated into your harness via the following hooks:

| Hook                                                   | Script             | Behavior                                                                                                                                                  |
| ------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UserPromptSubmit`                                     | `remind.js`        | Injects the condensed rules every N prompts (default 5) or every N tokens of context growth (default 4,000). Never blocks a prompt.                       |
| `PreToolUse` on `Write\|Edit\|MultiEdit\|NotebookEdit` | `check-banned.js`  | Scans the text the model is adding for banned terms. Default: deny the call with the violation list, so the model rewrites before anything lands on disk. |
| `SessionStart`                                         | `session-start.js` | Re-injects the condensed rules after compaction, when the model most likely lost them.                                                                    |
| `Stop` (off by default)                                | `check-output.js`  | Scans the final chat reply for banned terms. `block` forces a rewrite; `warn` queues a note for the next prompt.                                          |

You also get three commands to cover environments without hooks (like desktop apps):

- `/just-say-so:rules` — load the full rules into context for the rest of the session.
- `/just-say-so:remind` — inject the condensed reminder now.
- `/just-say-so:allow <term>` — permit a domain term the gate flagged: single words land in `disableWords`, collocations in `allowPhrases`, in this project's `.just-say-so.json`.

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
    "mode": "prompts", // "prompts" | "tokens" | "off"
    "everyPrompts": 5, // fire every N user prompts
    "everyTokens": 4000, // or: fire after N tokens of context growth
    "onSessionStart": ["compact"] // also inject on these SessionStart sources:
    // "startup", "resume", "clear", "compact"
  },
  "bannedCheck": {
    "mode": "block", // "block" | "warn" | "off"
    "tools": ["Write", "Edit", "MultiEdit", "NotebookEdit"],
    "exclude": [
      "**/package*.json",
      "**/*.lock",
      "**/node_modules/**",
      "**/*.min.*"
    ],
    "include": [], // when non-empty, only these paths get checked
    "disableWords": [], // opt out of specific built-in terms
    "allowPhrases": [], // collocations that neutralize matches inside them,
    // e.g. "robust regression" passes while bare "robust" stays blocked
    "additions": {
      // extend the list
      "words": [], // "ninja" or { "term": "ninja", "hint": "..." }
      "phrases": [],
      "patterns": [] // { "regex": "...", "flags": "i", "label": "..." }
    }
  },
  "outputCheck": { "mode": "off" }, // Stop-hook chat check: "off" | "warn" | "block"
  "rules": {
    "fullPath": null, // your own rules file, replaces rules/full.md
    "condensedPath": null, // replaces rules/condensed.md
    "messagesPath": null // overrides hook message strings, per key (rules/messages.json)
  }
}
```

Glob notes: a pattern without a slash matches the file's basename anywhere (`*.md`). A pattern with a slash matches the absolute path, and also the path relative to the project (`docs/**`).

### Bring your own rules

You might hate my rules, fair enough. To plug your own ruleset in, point `rules.fullPath` and `rules.condensedPath` at your own markdown, and edit the banned list through `disableWords` and `additions`. All the hooks, commands, and config machinery stay the same.

### Bring your own voice

Every sentence the hooks emit — deny reasons, the advisory label, the config-edit confirmation — lives in [rules/messages.json](rules/messages.json). Point `rules.messagesPath` at your own JSON to override any subset; unlisted keys keep the shipped English, and `{target}`/`{allowCommand}` placeholders are filled at runtime. This is how you run the enforcement side in another language, or just reword the nagging. One seam to know: the per-term hints ("use a concrete verb...") live in the banned list, not the message catalog, so a full translation swaps both files.

### Term matching

Matching is case-insensitive with word boundaries that treat hyphens as part of the word — a banned word inside an identifier or dependency name does not match. Phrases tolerate hyphen/space variation both ways. Curly quotes normalize to straight before matching. Matches inside an `allowPhrases` collocation do not count, so a project can permit "robust regression" while bare "robust" stays blocked. Terms in `rules/banned.json` marked `contextual` carry a condition a matcher cannot judge (the empty intensifiers, which the rules say to replace with a measurement), so they report as advisories and never block on their own.

The checker is stricter than the prose rule on purpose. The rules permit a buzzword "when it has precise meaning or is relevant to the domain" — a judgment call a regex cannot make, and one the model would argue its way through. Domain legitimacy is a per-project fact, so it lives in per-project config: add the term to `disableWords`, or the collocation to `allowPhrases`, in that project's `.just-say-so.json`. The deny message tells the model to route that decision to you, and includes the exact `allow` command to run once you agree.

Who authorized an allow-list change stays visible by construction. `/just-say-so:allow` is user-invoked, so consent is the invocation itself. When the model edits `.just-say-so.json` (or the global config) directly, the hook returns `permissionDecision: "ask"` — a confirmation prompt the harness enforces even in auto-accept modes. The model cannot silently exempt itself from the gate.

## Limits (it's not perfect, y'all)

- The checker cannot tell prose from code. A banned word in a string literal you asked for will trip it. Use `exclude`, `include`, `disableWords`, or `allowPhrases` to carve out what you need.
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
