# just-say-so

LLM-generated prose is not fit for human consumption. They speak to us as if we hold multiple PhDs. And yet, at the same time, their verbal shorthand feels like you've shown up late to a conversation.

`just-say-so` packages the rules I've used to tackle this problem, and it attempts to address one of the most frustrating aspects of working with agents in long conversations: attention decay. If you're using a coding harness (like Claude Code), you've already experienced this when the model forgets key things (like how to talk to you) and has to be reminded frequently. `just-say-so` plugs into your harness's hooks and can be configured to remind the agent either by turn count or token count, and to ensure the agent is reminded after compaction.

The `just-say-so` communication rules were adapted from the [ASD-STE100 standard](https://www.asd-ste100.org/) (Simplified Technical English), but they do not adhere to the 900-word-dictionary that ASD-STE100 is limited to.

## What it does

There are three behaviors:

1. **It reminds the agent of the rules on a schedule.** Rules stated once at session start lose force as the context grows. `just-say-so` re-injects a condensed version of the rules ([rules/condensed.md](rules/condensed.md)) at an interval you control.
2. **It checks the text the agent writes to files** against a banned-term list, then warns (default) or blocks. This comparison — text in, violations out — is _the checker_, and the rest of this document calls it that.
3. **It can verify chat replies too, after the fact** — off by default. The rules themselves always apply to chat; the reminders keep them in force. This switch controls only whether the checker also scans each finished reply for banned terms.

The plugin does this through hooks: commands your harness runs at fixed points, such as "the user submitted a prompt" or "the agent is about to edit a file."

| Hook                    | What it does                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UserPromptSubmit`      | Injects the condensed rules every 5 prompts, or every 4,000 tokens of context growth (both configurable). Never blocks your prompt.                                                                                                              |
| `SessionStart`          | Injects the condensed rules at the start of every context: new session, resume, `/clear`, and after compaction.                                                                                                                                  |
| `SubagentStart`         | Injects the condensed rules into each subagent when it spawns. Subagents start with fresh context and never see the main session's reminders — without this, they'd discover the rules only by violating them.                                    |
| `PreToolUse`            | Runs the checker on text the agent is adding through file tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). Default: warn — the write lands and the agent gets the violation list. `block` mode rejects the write; the agent rewrites first. |
| `Stop` (off by default) | Runs the checker on the agent's final chat reply. `block` forces a rewrite; `warn` queues a note for the next prompt.                                                                                                                            |

You also get three commands. They work in environments without hooks (like desktop apps), and anywhere you want manual control:

- `/just-say-so:rules` — load the full rules into context for the rest of the session.
- `/just-say-so:remind` — inject the condensed reminder now.
- `/just-say-so:allow <term>` — permit a term the checker flagged, by writing it to the project's `.just-say-so.json`. A single word becomes a whole-word exemption; a multiword phrase is exempted only as that phrase.

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

### Pinning a version in CI

`anthropics/claude-code-action` installs plugins from a marketplace URL or directory path. Neither form carries a branch, tag, or commit, so every run installs whatever sits on this repo's default branch. If your repository requires pinned dependencies, that is not enough.

Until the action supports refs, pin by vendoring — copying the plugin into your repository:

1. Copy `.claude-plugin/`, `hooks/`, `rules/`, `skills/`, and `src/` from a tagged release into your repository, for example under `.github/plugins/just-say-so/`.
2. Point the action at that directory:

   ```yaml
   with:
     plugin_marketplaces: ${{ github.workspace }}/.github/plugins/just-say-so
   ```

3. Record the tag you copied. To upgrade later, diff your copy against the new tag — for example `git diff v0.1.2 v0.1.3` in a clone of this repo — and apply what changed.

The copy needs no install step: zero npm dependencies, Node ≥ 18.

## Configuration

`just-say-so` works with no configuration. Install it and the defaults shown below apply.

When you want different behavior, create one or both of these files:

1. `~/.config/just-say-so/config.json` — your personal defaults. These apply in every project.
2. `.just-say-so.json` in a project's root — settings for that one project. `just-say-so` finds this file by walking up from the working directory, so it also applies when you work in a subdirectory.

Both files use the same JSON shape, and each one can set only the fields you care about. When the same field appears in more than one place, the project file wins over your personal file, and your personal file wins over the built-in defaults. Sections combine field by field. Lists and single values replace the whole default — so a custom `exclude` list replaces the default list, and you repeat any default entries you want to keep.

```jsonc
{
  "reminder": {
    "mode": "prompts", // "prompts" | "tokens" | "off"
    "everyPrompts": 5, // fire every N user prompts
    "everyTokens": 4000, // or: fire after N tokens of context growth
    "onSessionStart": ["startup", "resume", "clear", "compact"],
    // inject at the start of every context; trim the list to inject on fewer sources
    // (for example ["compact"] if your CLAUDE.md already carries the rules at startup)
    "onSubagentStart": true // brief each subagent with the condensed rules at spawn
  },
  "bannedCheck": {
    "mode": "warn", // "warn" | "block" | "off" — warn by default, like a linter; block is the hard gate
    "tools": ["Write", "Edit", "MultiEdit", "NotebookEdit"],
    "exclude": [
      "**/package*.json",
      "**/*.lock",
      "**/node_modules/**",
      "**/*.min.*"
    ],
    "include": [], // when non-empty, only these paths get checked
    "disableWords": [], // opt out of specific built-in terms
    "allowPhrases": [], // phrases that neutralize matches inside them — for example
    // "robust regression" passes while bare "robust" stays flagged
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

The `exclude` and `include` lists take glob patterns — path wildcards where `*` matches within one directory level and `**` matches across levels. A pattern without a slash matches the file's name anywhere (`*.md`). A pattern with a slash matches the absolute path, and also the path relative to the project (`docs/**`).

### Bring your own rules

You might hate my rules, fair enough. To plug your own ruleset in, point `rules.fullPath` and `rules.condensedPath` at your own markdown, and edit the banned list through `disableWords` and `additions`. All the hooks, commands, and config machinery stay the same.

### Bring your own voice

When the checker warns or blocks, it speaks in shipped English sentences (the violation report, the rewrite instruction, the confirmation prompt). Those sentences live in [rules/messages.json](rules/messages.json). To reword them, or to run the enforcement side in another language, copy that file, edit the sentences you want, and point `rules.messagesPath` at your copy. Sentences you leave out keep the shipped wording. The `{target}` placeholder is filled at runtime with the name of the file being checked.

One thing to know: the per-term hints ("use a concrete verb...") live in the banned list ([rules/banned.json](rules/banned.json)), not the message file. A full translation would need to edit both files.

### Term matching

Matching is case-insensitive. Word boundaries treat hyphens as part of the word, so a banned word inside an identifier or a dependency name (`robust-websocket`) does not match. Phrases match with spaces or hyphens (so "load bearing" and "load-bearing" both count). Curly quotes normalize to straight quotes before matching.

The checker (the banned-term comparison from "What it does") makes two kinds of exceptions: allowed phrases and advisory-only terms.

An **allowed phrase** is a phrase you list under `bannedCheck.allowPhrases` — in your project's `.just-say-so.json`, or in `~/.config/just-say-so/config.json` to allow it in every project. A banned term that appears inside one does not count as a violation. Use an allowed phrase when a banned word is correct in one specific phrase. For example, "robust regression" passes while bare "robust" stays flagged. When the word is a normal term across your whole project, use `bannedCheck.disableWords` instead: that removes the word from the checker entirely.

An **advisory-only term** reports but never blocks, even in block mode. You do not configure these — the plugin ships them, marked `contextual` in [rules/banned.json](rules/banned.json), and there is no config knob to create your own. The empty intensifiers (very, truly, crucial, vital) work this way because the rules ban them only when unquantified, and the checker cannot judge that condition. To silence one entirely, add it to `bannedCheck.disableWords`. I may make this configurable in future releases.

The checker is stricter than the prose rule on purpose. The rules permit a buzzword "when it has precise meaning or is relevant to the domain." That is a judgment call a regex cannot make, and one the model would argue its way through. Whether a term is a real domain term is a fact about your project, so it lives in your project's config: `disableWords` for a word, `allowPhrases` for a phrase. In block mode, the rejection message tells the model to suggest the `/just-say-so:allow` command to you.

One courtesy behavior to know: when the model edits `.just-say-so.json` or the global config through the file tools, the hook returns `permissionDecision: "ask"`, so you get a confirmation prompt before the change lands. Just be aware that this was done for visbility, not security. Determined agents have other ways to write files.

## Limits (it's not perfect, y'all)

- The checker cannot tell prose from code. A banned word in a string literal you asked for will trip it. Two pairs of knobs carve out what you need: `exclude` and `include` control which files get checked, while `disableWords` and `allowPhrases` control which terms count as violations.
- The checker never scans for may/might/could. The rules ban them only as padding, and a pattern match cannot tell padding ("this may be worth considering") from a factual claim ("the config may be overridden"). That rule reaches the model through the rules text alone.
- The interval reminder depends on the harness delivering `UserPromptSubmit` events. Subagent turns do not advance the prompt counter, and that is deliberate: the counter measures the main context, and a subagent's internal traffic burns tokens in its own separate context. Each subagent gets its own copy of the rules at spawn instead.
- This repo's own docs and tests name the banned words, so its `.just-say-so.json` excludes those paths. Expect the same in any repo that documents its style rules.

## Other harnesses

The Claude Code hook protocol (JSON on stdin, JSON on stdout, exit 2 blocks) became the de-facto convention across coding agents, so the core logic carries over. It still takes work to adapt to each harness, though. Codex delivers file edits as patches, Copilot drops prompt-hook output from config files, Gemini renames the events. [adapters/README.md](adapters/README.md) maps the verified per-harness constraints and the adapter contract.

### What works where

Only the Claude Code adapter exists today. This table shows what each harness's hook system can support once an adapter is built, checked against vendor docs (2026-09-20). "Untested" means the docs neither confirm nor deny it.

| Feature                                  | Claude Code | Codex     | Cursor¹   | Copilot                                        | Gemini CLI             | OpenCode                       | AGENTS.md only        |
| ---------------------------------------- | ----------- | --------- | --------- | ---------------------------------------------- | ---------------------- | ------------------------------ | --------------------- |
| Reminder every N prompts                 | yes         | yes       | yes       | **no**²                                        | yes                    | yes                            | no                    |
| Reminder every N tokens                  | yes         | untested³ | untested³ | no                                             | untested³              | untested³                      | no                    |
| Rules at every session start             | yes         | yes       | yes       | partial — new sessions only, not resume        | yes                    | yes                            | partial — static file |
| Re-inject after compaction               | yes         | yes       | untested  | no                                             | yes                    | partial — experimental event   | no                    |
| Banned words: warn before the write      | yes         | partial⁴  | yes       | partial — feedback arrives after the tool runs | untested               | untested                       | no                    |
| Banned words: block + rewrite            | yes         | partial⁵  | yes       | partial — tool arg shapes undocumented         | yes                    | yes                            | no                    |
| Confirm edits to the plugin's config     | yes         | **no**⁶   | yes       | partial — cloud agent downgrades to deny       | untested               | untested                       | no                    |
| Rules injected into subagents            | yes⁸        | untested⁹ | untested  | yes                                            | **no**¹⁰               | untested                       | no                    |
| Chat reply check                         | yes         | untested  | untested  | untested                                       | yes⁷                   | untested                       | no                    |
| Commands (`/rules`, `/remind`, `/allow`) | yes         | yes       | yes       | yes                                            | partial — TOML rewrite | partial — command-file rewrite | no                    |

1. Cursor ships a Claude-format compatibility layer, but its CLI never enumerated event coverage. Test every Cursor cell before trusting it.
2. Copilot drops config-file hook output on `userPromptSubmitted`. Per-prompt injection needs the Copilot SDK, which a file-based plugin is not.
3. Token counting reads Claude Code's transcript format. Each other harness needs its own token source.
4. Codex documents `additionalContext` on PreToolUse, but an open issue reported the runtime rejecting it.
5. Codex delivers edits as patch strings. The adapter must parse out added lines first.
6. Codex parses `"ask"` but does not act on it.
7. Gemini's `AfterAgent` rejects the model's reply text outright — the only harness with a pre-display chat gate.
8. Verified live (2026-09-20): the injection lands in the subagent's own transcript, and the briefed subagent's prose followed the rules.
9. Codex lists `SubagentStart` among its events, but nothing documents whether that event accepts injected context.
10. Gemini's documented event set has no subagent events at all.

The two big sacrifices: Copilot loses per-prompt reminders, the plugin's core feature — rules arrive once per new session and then decay. Codex loses the config confirmation and needs patch parsing before the banned gate functions.

## Development

Runtime code has zero dependencies and runs on Node ≥18. The test stack (vitest 5) is dev-only and needs Node ^22.12, ^24, or ≥26 to run the suite.

```
npm test               # run the suite
npm run test:watch     # watch mode
npm run test:coverage  # enforces 100% line coverage on src/lib/**
```

Test conventions live in [.ai/UnitTestGeneration.md](.ai/UnitTestGeneration.md). Hook logic sits in `src/lib/hooks/` as pure `run(input, env)` functions; the scripts in `src/hooks/` are stdin shims around them, exercised by the integration tests.

### Releases

Every shipped behavior change bumps the version in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — versions are install cache keys. Every released version gets a git tag (`v0.1.2`).

Stability promise for vendored copies: within a minor series (0.1.x), import paths and function signatures under `src/lib/` do not change. A script that calls `findViolations()` or `loadConfig()` from a copied tree stays safe across patch upgrades. Before 1.0, a minor bump (0.2.0) may change anything — the tag diff shows what moved.

## License

MIT
