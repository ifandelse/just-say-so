# just-say-so

**WARNING**: This repo is undergoing serious experimental churn. Consider it unstable for a bit.

LLM-generated prose is not fit for human consumption. They speak to us as if we hold multiple PhDs. And yet, at the same time, their verbal shorthand feels like you've shown up late to a conversation.

`just-say-so` packages the rules I've used to tackle this problem, and it attempts to address one of the most frustrating aspects of working with agents in long conversations: attention decay. If you're using a coding harness (like Claude Code), you've already experienced this when the model forgets key things (like how to talk to you) and has to be reminded frequently. `just-say-so` plugs into your harness's hooks and can be configured to remind the agent either by turn count or token count, and to ensure the agent is reminded after compaction.

The `just-say-so` communication rules were adapted from the [ASD-STE100 standard](https://www.asd-ste100.org/) (Simplified Technical English), but they do not adhere to the 900-word-dictionary that ASD-STE100 is limited to.

## What it does

There are three behaviors:

1. **It reminds the agent of the rules on a schedule.** Rules stated once at session start lose force as the context grows. `just-say-so` re-injects a condensed version of the rules ([rules/condensed.md](rules/condensed.md)) at an interval you control.
2. **It checks the text the agent writes.** The checker is [Vale](https://vale.sh), the prose linter. After the agent writes a file, a hook runs Vale on that file. The agent receives the alerts for the lines it added. These alerts never block the write, because the write already happened. In `block` mode, a Stop hook blocks the end of the turn while error-level alerts remain in the files the agent wrote this session. Opt-in settings extend the check to text the agent publishes through `gh` commands and MCP tools; that check runs before the tool call, because publication cannot be undone (see [Checking published text](#checking-published-text-gh-and-mcp-tools)).
3. **It can verify chat replies too, after the fact** (off by default). The rules themselves always apply to chat; the reminders keep them in force. This switch controls only whether Vale also lints each finished reply.

The plugin does this through hooks: commands your harness runs at fixed points, such as "the user submitted a prompt" or "the agent just wrote a file."

| Hook               | What it does                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UserPromptSubmit` | Injects the condensed rules every 5 prompts, or every 4,000 tokens of context growth (both configurable). Never blocks your prompt.                                                                                                                                                                                                                                      |
| `SessionStart`     | Injects the condensed rules at the start of every context: new session, resume, `/clear`, and after compaction. Also says so, once, when checks are on but the `vale` binary is missing.                                                                                                                                                                                 |
| `SubagentStart`    | Injects the condensed rules into each subagent when it spawns. Subagents start with fresh context and never see the main session's reminders — without this, they'd discover the rules only by violating them.                                                                                                                                                           |
| `PreToolUse`       | A confirmation prompt before the agent edits a policy file (`.just-say-so.json`, `.vale.ini`, a vocabulary `accept.txt`), plus the pre-publication check for `gh` commands and named MCP tools. In `block` mode the check denies the call before the text is published.                                                                                                  |
| `PostToolUse`      | Runs Vale on the file a tool just wrote (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). Alerts outside the lines this edit added are filtered out — on a legacy file, the agent answers for its own additions, not the file's history. Errors are recorded for the Stop gate.                                                                                            |
| `Stop`             | In `bannedCheck.mode: "block"`, the session gate: re-lint the recorded files and block the turn while their errors remain. When a rewrite leaves the same alerts, the gate reports once and lets the turn end. Also the reply check (`outputCheck`, off by default): `block` forces a rewrite; `warn` queues a note for the next prompt and prints the report to stderr. |

You also get three commands. They work in environments without hooks (like desktop apps), and anywhere you want manual control:

- `/just-say-so:rules` — load the full rules into context for the rest of the session.
- `/just-say-so:remind` — inject the condensed reminder now.
- `/just-say-so:allow <term>` — permit a term the checker flagged. The term goes to the project's Vale vocabulary when a `.vale.ini` names one, otherwise to `.just-say-so.json` — see [Exemptions](#exemptions). One word becomes a whole-word exemption; a multiword phrase is exempted only as that phrase.

### The Vale engine

Every check runs Vale. Vale is markup-aware, so code blocks and inline code in Markdown never match a rule. Each rule has its own severity, and any style in Vale's ecosystem plugs in. The same `.vale.ini` drives your editor squiggles, pre-commit, CI, and this plugin.

A check resolves its Vale config in this order, and the first match applies:

1. `vale.config` in the just-say-so config — an explicit path.
2. The nearest `.vale.ini` above the checked file, the walk Vale itself does.
3. The shipped fallback ([vale/fallback.ini](vale/fallback.ini)), which loads the `JustSaySo` style alone. The plugin works out of the box and gets stronger in repos that adopt Vale.

Severity is the policy language. `error` alerts block (at the Stop gate, at the `gh`/MCP deny, and in your CI); `warning` and `suggestion` arrive at edit time as advice and never block. Set a rule's level in `.vale.ini` to move it between those tiers. `vale.levels` sets the lowest level the agent sees at edit time.

Chat replies and published fragments lint under the filename `*.chat.md`. Give your `.vale.ini` a `[*.chat.md]` section with lexical and sentence-level rules only, and document-level rules (heading style, paragraph length) stay out of text that has no document.

**The JustSaySo style** ([styles/JustSaySo/](styles/JustSaySo/)) packages the banned list as Vale rules. `scripts/build-style.js` generates the style from [rules/banned.json](rules/banned.json), and a test fails when the two drift. The patterns treat a hyphen as a word character: `robust-websocket` never matches. A phrase matches with a space or a hyphen, and a curly quote matches its straight form. Any repo can use the style without the plugin:

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
```

The `vale` binary is a prerequisite for the checks — see [Prerequisites](#prerequisites) for the install and the fallback behavior.

### Checking text from scripts

The hooks check tool calls, and some text never arrives through one: a PR body in CI, or a file another pipeline generates. For that text, run `vale` with your config. Where a vale install is unavailable, the plugin ships a dependency-free fallback checker:

```
node "<plugin dir>/src/cli/check.js" [--format text|json] <file...>
echo "$PR_BODY" | node "<plugin dir>/src/cli/check.js" -
```

The exit code is 0 for clean text, 1 for banned terms, and 2 for usage or read errors. Advisory terms appear in reports and never change the exit code. The command matches against [rules/banned.json](rules/banned.json), the same data that generates the `JustSaySo` style. Config resolves from each file's directory, and stdin uses the working directory. `bannedCheck.exclude`, `include`, and `additions` apply only here. The command ignores `bannedCheck.mode`. It reports and sets the exit code; what happens next is up to the calling script.

## Install (Claude Code)

### Prerequisites

- `node` 18 or newer on your PATH. The plugin has zero npm dependencies.
- `vale` on your PATH: `brew install vale`, or another installer from [vale.sh](https://vale.sh). Without it, the checks are skipped and the reminders still work; `SessionStart` prints one notice.
  - ⚠️ A different tool, an STE linter, also installs a binary named `vale`. This plugin uses errata-ai vale — the one brew installs. If both are installed, put errata-ai's first on PATH.
- Claude Code 2.1.85 or newer, for the command filter the `gh` addon uses. Details are under [Checking published text](#checking-published-text-gh-and-mcp-tools).

### Plugin install

```
/plugin marketplace add ifandelse/just-say-so
/plugin install just-say-so@just-say-so
```

Local development:

```
claude --plugin-dir /path/to/just-say-so
```

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

1. `~/.config/just-say-so/just-say-so.json` — your personal defaults. These apply in every project. Set the `JUST_SAY_SO_CONFIG` environment variable to read this layer from a different path instead.
2. `.just-say-so.json` in a project's root — settings for that one project. `just-say-so` finds this file by walking up from the working directory, so it also applies when you work in a subdirectory.

Both files use the same JSON shape, and each one can set only the fields you care about. When the same field appears in more than one place, the project file wins over your personal file, and your personal file wins over the built-in defaults. Sections combine field by field. Lists and single values replace the whole default — so a custom `exclude` list replaces the default list, and you repeat any default entries you want to keep.

One more layer exists for pipelines: set `JUST_SAY_SO_FORCE_CONFIG` to a config file path, and that file's fields beat every other layer, project file included. Precedence is a property of the layer, never of where a file sits on disk: defaults ← personal ← project ← forced. Use it when a run must guarantee its policy — see [Single-prompt runs (CI)](#single-prompt-runs-ci).

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
    "mode": "warn", // "warn" | "block" | "off" — warn: edit-time advice only; block adds the Stop gate and the pre-publication deny
    "addons": [], // opt-in coverage bundles — "gh" is the only one so far
    "mcpTools": [], // MCP tool-name patterns to check, for example "mcp__confluence__*"
    "disableWords": [], // drop every Vale alert whose matched text is this term
    "allowPhrases": [], // phrases that neutralize alerts inside them — for example
    // "robust regression" passes while bare "robust" stays flagged
    "exclude": [], // CLI check.js only — the hooks scope files via .vale.ini sections
    "include": [], // CLI check.js only
    "additions": { "words": [], "phrases": [], "patterns": [] } // CLI check.js only — for the hooks,
    // add terms to your own Vale style or a vocabulary reject.txt
  },
  "outputCheck": { "mode": "off" }, // Stop-hook chat check: "off" | "warn" | "block"
  "vale": {
    "config": null, // explicit .vale.ini path; default: nearest above the checked file, else the shipped fallback
    "levels": "suggestion" // lowest alert level shown to the agent at edit time: "error" | "warning" | "suggestion"
  },
  "rules": {
    "fullPath": null, // your own rules file, replaces rules/full.md
    "condensedPath": null, // replaces rules/condensed.md
    "messagesPath": null // overrides hook message strings, per key (rules/messages.json)
  }
}
```

Which files get checked is Vale's decision now, made in `.vale.ini`: a `[glob]` section with an empty `BasedOnStyles` exempts its paths (this repo's own [.vale.ini](.vale.ini) does exactly that for the docs and tests that name the banned words). `exclude`, `include`, and `additions` still apply to the `check.js` CLI, which runs the built-in matcher.

### Checking published text (gh and MCP tools)

The file gate catches what the agent writes to disk. PR comments and Confluence pages go out through `gh` commands and MCP tools instead, and by default nothing checks them. Two opt-in settings close that:

`"addons": ["gh"]` covers the gh commands that publish prose: `create`, `comment`, `edit`, and `review` under `gh pr`; `create`, `comment`, and `edit` under `gh issue`; `create` and `edit` under `gh release`. When one of those appears anywhere in a Bash command — compound commands included — the checker scans the entire command text. It does not look for a `--body` flag first: a triggered command with no prose scans clean at no cost, and prose hides in more flags than `--body` (a `--title`, for example).

`"mcpTools": ["mcp__confluence__*", "mcp__jira__*"]` names the MCP tools to check, with `*` wildcards. On a matching call, the checker scans every string argument, nested fields included. You name the tool; you never have to know which argument carries the body. The trade-off is an occasional flag on a non-prose field such as an ID or a query — `disableWords` and `allowPhrases` handle those.

The collected text lints as a fragment named `fragment.chat.md`, so the `[*.chat.md]` section of your config applies — lexical rules judge a fragment fine, document-level rules do not.

Timing matters more here than at file writes. In `block`, the deny lands before the tool runs, so a flagged comment never reaches GitHub — this is the one place the plugin still blocks before an action instead of gating at Stop, because no later gate can un-publish. In `warn`, the call proceeds, the text is published, and the agent gets the report after the fact. If you turned this on because your agent publishes, use `block`.

Known gaps, on purpose:

- `gh api` can publish too, and the checker ignores it. It is a raw API tool; covering it means parsing arbitrary API calls forever.
- A `--body-file` body is not in the command text. In most workflows the agent wrote that file moments earlier through a file tool, where the checker already scanned it.
- On Claude Code releases older than v2.1.85, the Bash hook runs on every Bash command instead of only gh commands — the `if` filter in the hook wiring arrived in that release. The results are identical; older versions pay a small startup cost per command.

Upgrading from 0.2.x: the checker engine is Vale now. `bannedCheck.mode: "block"` no longer rejects a file write before it happens. Block mode now works at the Stop hook for files, and still denies `gh`/MCP publishing before the call runs. `exclude`, `include`, and `additions` moved to CLI-only — scope the hooks' file coverage with `.vale.ini` sections, and ship custom terms as Vale rules or a vocabulary `reject.txt`. Upgrading from 0.1.x: `bannedCheck.tools` is gone — the hook wiring is fixed at install, so no config field can widen coverage.

### Single-prompt runs (CI)

Non-interactive runs (for example `anthropics/claude-code-action`) submit one prompt and end. Two behaviors matter there:

- `outputCheck.mode: "warn"` delivers its report two ways: a note injected at the next user prompt, and the same report on the Stop hook's stderr. A single-prompt run has no next prompt, so the stderr line in the job log is the only visible copy.
- `reminder.mode: "off"` stops the interval reminders, not the session-start injection — `onSessionStart` applies regardless of `reminder.mode`. So `{ "reminder": { "mode": "off", "onSessionStart": ["startup"] } }` injects the rules once at the start and never repeats: the right shape for a single-prompt run.

To run CI stricter than developers' machines, commit a config for it and point the forced layer at that file:

```yaml
env:
  JUST_SAY_SO_FORCE_CONFIG: ${{ github.workspace }}/.github/just-say-so.ci.json
```

```json
{
  "reminder": { "mode": "off", "onSessionStart": ["startup"] },
  "bannedCheck": { "mode": "warn" },
  "outputCheck": { "mode": "block" }
}
```

Fields the forced file sets win over the project file, so a mode committed to `.just-say-so.json` can never weaken the CI policy. Fields it leaves out fall through normally — the project's shared word lists still apply.

### Bring your own rules

You might hate my rules, fair enough. To plug your own ruleset in, point `rules.fullPath` and `rules.condensedPath` at your own markdown, and edit the banned list through `disableWords` and `additions`. All the hooks, commands, and config machinery stay the same.

### Bring your own voice

When the checker warns or blocks, it speaks in shipped English sentences (the violation report, the rewrite instruction, the confirmation prompt). Those sentences live in [rules/messages.json](rules/messages.json). To reword them, or to run the enforcement side in another language, copy that file, edit the sentences you want, and point `rules.messagesPath` at your copy. Sentences you leave out keep the shipped wording. The `{target}` placeholder is filled at runtime with the name of the file being checked.

One thing to know: the per-term hints ("use a concrete verb...") live in the banned list ([rules/banned.json](rules/banned.json)), not the message file. A full translation would need to edit both files.

### Exemptions

The rules permit a buzzword "when it has precise meaning or is relevant to the domain." A linter cannot make that judgment, and the model would argue its way through it. Whether a term is a real domain term is a fact about your project, and the exemption belongs to your project. The `/just-say-so:allow` command stores it in the right place:

The **Vale vocabulary** is the native route. When a `.vale.ini` above the project names `StylesPath` and `Vocab`, `/allow` appends the term to that vocabulary's `accept.txt`. Vale adds every accepted entry to the exception list of every active rule, across all styles — so "robust regression" passes any rule while bare "robust" stays flagged, verified against Vale 3.22.

The **config route** is the fallback. Without a vocabulary to write to, `/allow` adds the term to `.just-say-so.json` as before: single words to `disableWords`, collocations to `allowPhrases`. The hooks apply both lists to every Vale alert — `disableWords` drops alerts whose matched text is the term (case-insensitive, hyphen and space interchangeable), `allowPhrases` drops alerts whose span sits inside the phrase — so the exemption works against the `JustSaySo` style and any other style you run, with or without a vocabulary.

In block mode, the rejection message tells the model to suggest the `/just-say-so:allow` command to you, quoting the collocation as it appears in the text.

The hooks also confirm policy edits. When the model edits `.just-say-so.json`, a `.vale.ini`, a vocabulary `accept.txt`, or the global config through the file tools, the hook returns `permissionDecision: "ask"`, and you get a confirmation prompt before the edit applies. The vocabulary is the model's easiest self-exemption, which is why it gets the same prompt. Just be aware that this was done for visibility, not security. Determined agents have other ways to write files.

## Limits (it's not perfect, y'all)

- Vale is markup-aware: code blocks and inline code in Markdown never match a rule. A file format Vale cannot identify scans as plain text, where a banned word in a string literal still flags; exempt those paths in `.vale.ini`.
- The edit-scoped feedback locates an `Edit` by searching for its `new_string` in the written file. A string that repeats yields the union of candidate ranges — extra facts, never a miss. A `Write` that replaced a file has nothing to diff against, so the whole file counts and the message says so.
- The checker never scans for may/might/could. The rules allow bare modals when they state real uncertainty or permission. The banned hedge frames are phrases: the checker catches the ones in its phrase list, and the remaining frames appear to the model only in the rules text.
- The interval reminder depends on the harness delivering `UserPromptSubmit` events. Subagent turns do not advance the prompt counter, and that is deliberate: the counter measures the main context, and a subagent's internal traffic burns tokens in its own separate context. Each subagent gets its own copy of the rules at spawn instead.
- This repo's own docs and tests quote the banned words, and its `.vale.ini` turns every style off for those paths (`.just-say-so.json` excludes them for the CLI). Expect the same in any repo that documents its style rules.

## Other harnesses

The Claude Code hook protocol (JSON on stdin, JSON on stdout, exit 2 blocks) became the de-facto convention across coding agents, so the core logic carries over. It still takes work to adapt to each harness, though. Codex delivers file edits as patches, Copilot drops prompt-hook output from config files, Gemini renames the events. [adapters/README.md](adapters/README.md) maps the verified per-harness constraints and the adapter contract.

### What works where

Only the Claude Code adapter exists today. This table shows what each harness's hook system can support once an adapter is built, checked against vendor docs (2026-09-20). "Untested" means the docs neither confirm nor deny it. ⚠️ The rows describe the pre-Vale checker design (0.2.x); the Vale engine moves file blocking to the Stop hook and adds a PostToolUse run, so re-verify the relevant events per harness before building an adapter.

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
