# just-say-so

**WARNING**: This repo is undergoing serious experimental churn. Consider it unstable for a bit.

LLM-generated prose is not fit for human consumption. They speak to us as if we hold multiple PhDs. And yet, at the same time, their verbal shorthand feels like you've shown up late to a conversation.

`just-say-so` packages the rules I use to tackle this problem. It also targets one of the most frustrating aspects of long agent conversations: attention decay. In a coding harness like Claude Code, the model forgets key things, such as how to talk to you, and you remind it again and again. `just-say-so` plugs into your harness's hooks. It puts the rules into context at the start of every session, again after compaction, and again on the prompt after a reply broke one.

I adapted the `just-say-so` communication rules from the [ASD-STE100 standard](https://www.asd-ste100.org/) (Simplified Technical English). The rules do not adopt the 900-word dictionary that limits ASD-STE100.

## What it does

There are three behaviors:

1. **It re-injects the rules when they slip.** Rules stated once at session start lose force as the context grows. `just-say-so` lints each finished reply and re-injects a condensed version of the rules ([rules/condensed.md](rules/condensed.md)) on the prompt after a reply breaks one, with a report of which rules broke. The text it injects is adjusted to the project's Vale config: a bullet whose installed Vale rules the project turned off is left out, and error-level rules in the project that no bullet describes are named at the end (see [The rules manifest](#the-rules-manifest)). There is no interval reminder. A reminder that carries no new information measured as no help, so the rules go out at three moments only: context start, subagent start, and the prompt after a violation.
2. **It checks the text the agent writes.** The checker is [Vale](https://vale.sh), the prose linter. After the agent writes a file, a hook runs Vale on that file. The agent receives the alerts for the lines it added. These alerts never block the write, because the write already happened. In `block` mode, a Stop hook blocks the end of the turn while error-level alerts remain in the files the agent wrote this session. Opt-in settings extend the check to text the agent publishes through `gh` commands and MCP tools. That check runs before the tool call, because nothing can un-publish a comment (see [Checking published text](#checking-published-text-gh-and-mcp-tools)).
3. **It verifies chat replies after the fact.** The rules themselves always apply to chat. This check controls whether Vale also lints each finished reply. In `warn` mode, the default, the result never interrupts anyone. The hook counts the broken rules, and the next rules injection includes a short report of rule names and counts. That injection is the next prompt, or the next context start when `rules.onViolation` is off.

Each of those is a **target**, and the config is keyed by them: `files`, `publish`, and `reply`, each with one `mode` of `off`, `warn`, or `block`. Which rules apply to each target is Vale's job, in `.vale.ini`, keyed by the name the text lints under. The plugin decides only when to lint, what text to hand Vale, and what happens with the result.

The plugin does this through hooks. A hook is a command your harness runs at a fixed point, such as "the user submitted a prompt" or "the agent just wrote a file."

| Hook               | What it does                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UserPromptSubmit` | Injects the condensed rules, with the reply report, on the prompt after a reply broke a rule. On `/just-say-so:restate`, records the rejected reply instead. Never blocks your prompt. |
| `SessionStart`     | Injects the condensed rules at the start of every context: new session, resume, `/clear`, and after compaction. Also says so, once, when checks are on but the `vale` binary is missing, when the Vale config predates the 0.9.0 names, or when a config file still sets 0.8.x keys. |
| `SubagentStart`    | Injects the condensed rules into each subagent when it spawns. Subagents start with fresh context and never see the main session's reminders — without this, they'd discover the rules only by violating them.                                                                                                                                                           |
| `PreToolUse`       | A confirmation prompt before the agent edits a policy file (`.just-say-so.json`, `.vale.ini`, a vocabulary `accept.txt`), plus the pre-publication check for `gh` commands and named MCP tools. In `block` mode the check denies the call before the text is published.                                                                                                  |
| `PostToolUse`      | Runs Vale on the file a tool just wrote (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). The hook drops alerts outside the lines this edit added, so on a legacy file the agent answers only for its own additions. The hook records errors for the Stop gate, and keeps an earlier edit's unfixed errors on record when a later edit to the same file is clean.                                                                                            |
| `Stop`             | In `files.mode: "block"`, the session gate: re-lint the recorded files and block the turn while their errors remain. When a rewrite leaves the same alerts, the gate reports once, lets the turn end, and waives those alerts for the rest of the session. Also the reply check (`reply.mode`): `block` forces a rewrite; `warn`, the default, records per-rule counts, which ride the next rules injection as a report. After `/just-say-so:restate`, adds the rewrite to the rejection record. |

You also get four commands. They work in environments without hooks (like desktop apps), and anywhere you want manual control:

- `/just-say-so:rules` — load the full rules into context for the rest of the session.
- `/just-say-so:remind` — inject the condensed reminder now.
- `/just-say-so:restate [reason]` — the previous reply broke the rules in a way you noticed. The model rewrites it under the condensed rules, and the plugin saves the rejected reply, your reason, and the rewrite as a labeled example. See [Rejected replies](#rejected-replies).
- `/just-say-so:allow <term>` — permit a term the checker flagged. The term goes to the project's Vale vocabulary, and the command adds the `Vocab` key to `.vale.ini` when it lacks one — see [Exemptions](#exemptions). One word becomes a whole-word exemption; a multiword phrase is exempted only as that phrase.

### The Vale engine

Every check runs Vale. Vale is markup-aware, so code blocks and inline code in Markdown never match a rule. Each rule has its own severity, and any style in Vale's ecosystem plugs in. The same `.vale.ini` drives your editor squiggles, pre-commit, CI, and this plugin.

A check resolves its Vale config in this order, and the first match applies:

1. `vale.config` in the just-say-so config — an explicit path.
2. The nearest `.vale.ini` above the checked file, the walk Vale itself does.
3. The shipped fallback ([vale/fallback.ini](vale/fallback.ini)), which loads the `JustSaySo` style alone. The plugin works without a `.vale.ini`, and a repo that adds one brings its own styles into the check.

Severity is the policy language. `error` alerts block, at the Stop gate, at the `gh`/MCP deny, and in your CI. `warning` and `suggestion` alerts arrive at edit time as advice and never block. Set a rule's level in `.vale.ini` to move it between those tiers. `files.show` sets the lowest level the agent sees at edit time.

Chat replies lint under the name `reply.reply`. Published text lints under `<source>.<tool>.<field>.publish`: a PR body is `gh.pr.body.publish`, a release title is `gh.release.title.publish`, and a Jira call is `mcp.jira.create_issue.publish`. Those extensions are the contract with your `.vale.ini`: a `[*.reply]` section picks the rules for chat, `[*.publish]` the rules for published text, and `[gh.*.title.publish]` the rules for titles alone. A `[*.md]` section never matches them, so your document rules (heading style, paragraph length) stay out of text that has no document. The `[formats]` lines below parse both as Markdown, so code spans are still skipped.

Write the shared rules once in a `[*]` section and narrow them per target with `Style = NO` or `Style.Rule = level` lines. Two Vale behaviors decide what works. A `Style.Rule = level` line in `[*]` applies in every narrower section. A `BasedOnStyles` line in a narrower section replaces the `[*]` list instead of adding to it, so repeat the whole list or leave the line out.

```ini
[formats]
reply = md
publish = md

[*]
BasedOnStyles = JustSaySo, ai-tells

[*.reply]
ai-tells.ParagraphLength = NO

[gh.*.title.publish]
ai-tells.SentenceLength = NO
```

**The JustSaySo package** packages the banned list as Vale rules ([styles/JustSaySo/](styles/JustSaySo/)) together with a `.vale.ini` that carries the `[formats]` lines and the `[*.reply]` and `[*.publish]` sections. Add it to a repo's `Packages` and run `vale sync`, and Vale merges those sections into the repo's config. Your own keys win on conflict, and `BasedOnStyles` lists in the same section combine. A repo that uses the package needs no chat sections of its own:

```ini
Packages = https://github.com/ifandelse/just-say-so/releases/download/<tag>/JustSaySo.zip
```

`scripts/build.js` generates the style from [rules/manifest.json](rules/manifest.json), and a test fails when the two drift. The patterns treat a hyphen as a word character: `robust-websocket` never matches. A phrase matches with a space or a hyphen, and a curly quote matches its straight form. The rules are plain `existence` and `substitution` rules without `nonword`, so a Vale vocabulary exempts a term or a collocation from them. The package's `.vale.ini` is [vale/fallback.ini](vale/fallback.ini) without its `StylesPath` line, so the fallback and the package lint the same way.

The `vale` binary is a prerequisite for the checks — see [Prerequisites](#prerequisites) for the install and the fallback behavior.

### Checking staged text (pre-commit and CI)

The hooks above run only inside a Claude Code session. Text reaches a repository in other ways too. A teammate commits by hand, an agent writes a file through a shell command, or a pipeline generates one. The commit gate covers those paths. It runs Vale on the lines a commit adds, and it fails the commit when any of those lines has an error-level alert. It needs `git`, `node`, and `vale`. It does not need the plugin, so every committer meets the same policy.

The gate has two modes:

```
node "<repo or plugin dir>/src/cli/check-staged.js"              # pre-commit: what you are about to commit
node "<repo or plugin dir>/src/cli/check-staged.js" --base main  # CI: everything a branch added since main
```

**What it checks.** Markdown and HTML files: `.md`, `.mdx`, `.markdown`, `.html`, and `.htm`. Generated HTML such as a coverage report or a built docs site enters the gate too, so exempt those paths in `.vale.ini`. Within the checked files, only the lines you added. A file with old problems does not fail your commit when you touch one paragraph of it. The one exception is a rule that judges the whole document, such as a `metric` rule for sentence length or an `occurrence` rule with document-wide scope. Vale reports those at line 1, so the gate keeps them whenever the file changed at all.

**Pre-commit mode** lints the staged content, so it sees exactly what will land. If you stage half of a file with `git add -p`, the gate checks that half and ignores the rest. **`--base` mode** lints the working tree and keeps the lines added since the merge-base with the ref you name, uncommitted edits included. An untracked prose file counts as added in full. That gives CI the same check over a whole branch, and `--base HEAD` checks exactly the lines you have not committed yet.

**Exit codes:**

- `0`: clean, or only warnings and suggestions.
- `1`: at least one error-level alert on an added line. The report lists them.
- `2`: `git` or `vale` failed, so the line filter cannot be trusted. The gate refuses to pass a commit it could not check.

**Escape hatches.** To skip the gate for one commit, run `JUST_SAY_SO_PRECOMMIT=0 git commit ...`. When `vale` is missing from PATH, the gate prints a notice and exits 0. Adding the gate to a repo never blocks commits on a machine without Vale.

**Configuration** is the `.vale.ini` alone: the nearest one above the file, or the shipped fallback when there is none. A term you allowed during a session lives in that config's vocabulary, so it is allowed at commit time too.

**Installing it** in a repository, by preference:

1. **The [pre-commit framework](https://pre-commit.com).** This repo ships [.pre-commit-hooks.yaml](.pre-commit-hooks.yaml). Pin the hook at a tag, and the framework clones the script at that revision:

   ```yaml
   repos:
     - repo: https://github.com/ifandelse/just-say-so
       rev: v0.5.0
       hooks:
         - id: vale-staged
   ```

2. **Husky or plain `.git/hooks`.** Add this repo as a dev dependency from a tag, then call the bin from your hook. The lockfile is the pin, and the package has no transitive dependencies:

   ```json
   { "devDependencies": { "just-say-so": "github:ifandelse/just-say-so#v0.5.0" } }
   ```

   ```
   node_modules/.bin/just-say-so-staged
   ```

Do not point a hook at the Claude plugin cache. The path there is machine-specific and version-suffixed, and the hook silently skips every committer who lacks the plugin.

## Install (Claude Code)

### Prerequisites

- `node` 18 or newer on your PATH. The plugin has zero npm dependencies.
- `vale` on your PATH: `brew install vale`, or another installer from [vale.sh](https://vale.sh). Without it, the hooks skip the checks and the reminders still work. `SessionStart` prints one notice.
  - ⚠️ A different tool, an STE linter, also installs a binary named `vale`. This plugin uses errata-ai vale — the one brew installs. If you have both, put errata-ai's first on PATH.
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

Both files use the same JSON shape, and each one can set only the fields you care about. When the same field appears in more than one place, the project file wins over your personal file. Your personal file wins over the built-in defaults. Sections combine field by field. Lists and single values replace the whole default. No rule lives in these files. A rule in a personal file would make the harness disagree with the commit hook, so rules, levels, and exemptions live in `.vale.ini` only.

One more layer exists for pipelines: set `JUST_SAY_SO_FORCE_CONFIG` to a config file path, and that file's fields beat every other layer, project file included. Precedence belongs to the layer: defaults ← personal ← project ← forced. Where a file sits on disk never changes it. Use it when a run must guarantee its policy — see [Single-prompt runs (CI)](#single-prompt-runs-ci).

```jsonc
{
  "files": {
    "mode": "warn", // "off" | "warn" | "block" — warn: edit-time facts only; block adds the Stop gate
    "show": "suggestion" // lowest alert level shown to the agent at edit time: "error" | "warning" | "suggestion"
  },
  "publish": {
    "mode": "block", // "off" | "warn" | "block" — nothing can un-publish, so block is the default
    "gh": false, // check the gh commands that publish prose (see Checking published text)
    "mcp": [], // MCP tool-name patterns to check, for example "mcp__confluence__*"
    "unresolved": "ask" // a published value the checker cannot read: "ask" | "allow" | "deny"
    // ("ask" acts as "allow" under automatic-permission harness modes)
  },
  "reply": {
    "mode": "warn" // "off" | "warn" | "block" — warn: count broken rules per reply and report them
    // with the next rules injection; block: rewrite before the turn ends
  },
  "rules": {
    "onContextStart": ["startup", "resume", "clear", "compact"],
    // inject at the start of every context; trim the list to inject on fewer sources
    // (for example ["compact"] if your CLAUDE.md already carries the rules at startup)
    "onSubagentStart": true, // brief each subagent with the condensed rules at spawn
    "onViolation": true, // inject the rules plus the reply report on the prompt after a flagged reply;
    // false holds the report for the next context start
    "manifest": null, // your own rules manifest, replaces rules/manifest.json (see The rules manifest)
    "extra": null, // a manifest fragment whose sections are appended to the one in force
    "messagesPath": null // overrides hook message strings, per key (rules/messages.json)
  },
  "vale": {
    "config": null // explicit .vale.ini path; default: nearest above the checked file, else the shipped fallback
  },
  "events": {
    "mode": "on" // "on" | "off" — the events log (see What the plugin records); off writes nothing
  }
}
```

Vale decides which files get checked, in `.vale.ini`. A `[glob]` section with an empty `BasedOnStyles` exempts its paths. This repo's own [.vale.ini](.vale.ini) does exactly that for the docs and tests that name the banned words.

`reply.mode: "warn"` is the quiet reply check, and the default. The Stop hook lints each finished reply and keeps the error-level alerts as per-rule counts in session state. It returns nothing to the harness. The next rules injection in the main session appends a report below the rules. With `rules.onViolation` on (the default) that injection is the next prompt: the model sees the rules and the report one prompt after the reply that broke them. With it off the counts wait for a resume or the post-compaction injection. The report has one line per rule with its count, capped at ten lines. A short fixed match such as a banned word appears on its line. A longer match is a span of the old reply, so that line names the rule alone, and two styles that flag the same span count once. An instruction follows it: apply the rules to the next replies and leave earlier replies alone. The counts reset on delivery. Subagent injections do not include the report. Use `block` when you want the flagged reply itself fixed.

### Rejected replies

Vale checks what its styles can detect, and a reader notices more than that. When a reply breaks the rules in a way you noticed, run `/just-say-so:restate`, with a reason if you have one: `/just-say-so:restate verbal shorthand`. The model rewrites the reply under the condensed rules and changes nothing else. A wrong answer is a different problem: correct it in an ordinary prompt, so the records stay about prose.

The plugin records each rejection. The prompt hook reads the rejected reply from the transcript, so the text is what the model wrote and not what it remembers writing. It lints that text at every Vale level and appends one JSON line to `rejections.jsonl` in the state directory: `$CLAUDE_PLUGIN_DATA/state` under a plugin install, otherwise `~/.local/state/just-say-so`. The Stop hook adds the rewrite and its alerts to the same line when the turn ends. In `block` mode a rewrite that the gate rejects is not the one saved; the record closes with the reply the gate lets stand. The rejected reply's own `warn` counts go with the record instead of riding the next prompt, so a later report describes the rewrite and not the reply you already rejected. A record holds the session id, the project directory, the prompt index, the reason, both texts with their alerts, the plugin version, and the reminder and reply-check settings in force. Replies can quote code, logs, paths, and customer data, so the file stays on your machine. Nothing writes it into a project or sends it anywhere.

What the file is for: a rejected reply that Vale passed points at a missing rule or a level set too low. A reason that recurs suggests a rule in `rules/condensed.md` needs different wording. Rejected and rewritten pairs form a test set for any judge that scores replies against the rules. Rejections divided by prompts is a drift rate for one user's sessions, which compares reminder settings for that user. These records tune your configuration. They do not fine-tune a model.

### What the plugin records

Two files in the state directory hold everything the plugin keeps beyond the current session. Nothing leaves your machine, and nothing is written into a project.

`rejections.jsonl` holds one record per `/just-say-so:restate`, described above. Since 0.8.0 a record also carries the prompt that produced the rejected reply, the model id, and the number of prompts between the last rules injection and that reply. The prompt and both replies are prose, so this file can hold anything a session did. Scrub it before you share it.

`events.jsonl` holds one line per countable thing a hook saw. It carries rule names, counts, and settings, never prose, so a rejection can be read as a rate. Every line has a timestamp, an event type, the session id, the project directory, and the plugin version. The types:

| Event | When | Fields |
| --- | --- | --- |
| `session` | SessionStart | `source`, whether Vale was found, and the reminder, reply-check, edit-check, and Vale level settings in force |
| `reminder` | the rules go out | `promptIndex`, `trigger` (`report`, `session`, `restate`), `withReport` |
| `reply` | every Stop | `promptIndex`, `sinceReminder`, `outcome` (`pass`, `block`, `standdown`), the model id, `alerts` folded to counts per rule and level, and `rewriteOf` when the reply closed a rejection record |
| `restate` | `/just-say-so:restate` | `promptIndex`, `sinceReminder`, the record id, `reasonGiven` |
| `allow` | `/just-say-so:allow` | the term, where it went, and whether it was new |

A `reply` line folds Vale alerts at every level, not only errors, so a warning that fired on a reply you then rejected is visible. A match that equals one of the shipped banned terms appears on its entry; any other match is reply text and is left out, whichever style produced it. Two styles that flag one span count once. A block cycle writes one `reply` line per attempt, so the last line for a prompt index is the turn's outcome. With the log on, the Stop hook lints the reply even when `reply.mode` is `off`. That is one local Vale run per turn and no tokens. `alerts` is `null` when Vale is missing, so unlinted turns are countable too.

The file is never pruned. A line is under 300 bytes, so a year of heavy use is a few megabytes. Set `events.mode` to `off` to write nothing; the log-only reply lint stops with it.

What the log answers that a rejection alone cannot: rejections per hundred prompts across weeks, whether the rate climbs with distance from the last reminder, which rules fire that you never restate on, and which replies you restate on that fired nothing. The summary that reads both files is not shipped yet.

### Checking published text (gh and MCP tools)

The file gate catches what the agent writes to disk. PR comments and Confluence pages go out through `gh` commands and MCP tools instead, and by default nothing checks them. These opt-in settings cover them:

`"publish": { "gh": true }` covers the gh commands that publish prose: `create`, `comment`, `edit`, and `review` under `gh pr`, `gh issue`, and `gh release`, plus `gh api` calls that write a prose field: `-f`/`-F`/`--field`/`--raw-field` with the key `body`, `title`, `description`, or `notes`, a nested key such as `comments[][body]`, or a `--input` JSON file that holds one of those keys at any depth. A review with inline comments has to go through `--input`, and each comment lints as its own fragment, labeled by its path in the file (`--input comments[3].body`). When one of those appears anywhere in a Bash command, compound commands included, the checker extracts the text the command publishes and lints only that. It lints the `--title`, `--body`, and `--notes` values, and the contents of a `--body-file`, `--notes-file`, or `@file` reference, read at check time. Each value is its own fragment with its own line numbers. The checker never lints the command string itself. Flags and paths are shell syntax, and a punctuation rule would read `--body` as prose and deny every flagged command.

A value the extractor cannot read is **unresolved**: a `$(...)` substitution, a variable, backticks, stdin, a heredoc, or a `gh api --input` file that is not JSON. The checker refuses to guess what the shell will produce. `publish.unresolved` decides what happens in block mode. `"ask"` (the default) raises a permission prompt that names the construct. `"allow"` lets the call through with an "Unchecked values" note in the hook output. `"deny"` rejects the call. Under a harness permission mode that answers prompts automatically (`bypassPermissions`, `dontAsk`, `auto`), a configured `"ask"` acts as `"allow"`. A prompt nobody answers is a deny in a headless run, and that false deny is worse than a visible warning. Headless pipelines that want strictness set `"unresolved": "deny"`, typically through `JUST_SAY_SO_FORCE_CONFIG`.

`"publish": { "mcp": ["mcp__confluence__*", "mcp__jira__*"] }` names the MCP tools to check, with `*` wildcards. On a matching call, the checker scans every string argument, nested fields included. You name the tool; you never have to know which argument carries the body. The trade-off is an occasional flag on a non-prose field such as an ID or a query — a vocabulary entry handles those.

Each value lints as its own fragment, named `gh.<subcommand>.<field>.publish` for a gh command (`gh.pr.body.publish`, `gh.api.body.publish`) and `mcp.<server>.<tool>.publish` for an MCP call. The `[*.publish]` section of your config applies, and a narrower glob such as `[gh.*.title.publish]` applies to one field — lexical rules judge a fragment fine, document-level rules do not.

Timing matters more here than at file writes. In `block`, the hook denies the call before the tool runs, so GitHub never receives a flagged comment. This is the one place the plugin still blocks before an action instead of gating at Stop, because no later gate can un-publish. In `warn`, the call proceeds, the text goes out, and the agent gets the report after the fact. If you turned this on because your agent publishes, use `block`.

Known gaps, on purpose:

- `gh api` is covered only through the prose keys above. A string under any other key, in a field or an `--input` body, goes out unchecked.
- The checker reads a `--body-file` at check time, and the file can change before the command runs. Every pre-commit-style checker shares that gap.
- On Claude Code releases older than v2.1.85, the Bash hook runs on every Bash command instead of only gh commands. The `if` filter in the hook wiring arrived in that release. The results are identical. Older versions pay a small startup cost per command.

Upgrading from 0.9.x: `rules.fullPath` and `rules.condensedPath` are gone. The rules text renders from [rules/manifest.json](rules/manifest.json); point `rules.manifest` at a manifest of your own, or add bullets with `rules.extra`. See [The rules manifest](#the-rules-manifest). Upgrading from 0.8.x: the config is keyed by target now, and there is no compatibility shim. A file that still sets `reminder`, `bannedCheck`, or `outputCheck` configures nothing, and session start names the file and the keys once per session. The table maps the old keys to the new ones:

| 0.8.x | 0.9.0 |
| --- | --- |
| `bannedCheck.mode` | `files.mode` for written files; `publish.mode` for gh and MCP text |
| `bannedCheck.addons: ["gh"]` | `publish.gh: true` |
| `bannedCheck.mcpTools` | `publish.mcp` |
| `bannedCheck.unresolved` | `publish.unresolved` |
| `vale.levels` | `files.show` |
| `outputCheck.mode` | `reply.mode` |
| `outputCheck.deliver: "next-reminder"` | `rules.onViolation: false` |
| `reminder.onSessionStart` | `rules.onContextStart` |
| `reminder.onSubagentStart` | `rules.onSubagentStart` |
| `reminder.mode`, `everyPrompts`, `everyTokens` | removed; see What it does |
| `bannedCheck.disableWords`, `allowPhrases` | the Vale vocabulary; `/just-say-so:allow` writes it |
| `bannedCheck.exclude`, `include`, `additions`, the `check.js` CLI | removed; `.vale.ini` sections scope files, a Vale style or `reject.txt` adds terms, and `vale` itself checks text from scripts |

Chat and published text no longer lint as `*.chat.md`. A `[*.chat.md]` section matches nothing now; rename it to `[*.reply]` or `[*.publish]`, and add the `[formats]` lines or the JustSaySo package so both parse as Markdown. Session start prints one notice while a dead section or the missing mapping remains. Upgrading from 0.2.x: the checker engine is Vale now. `bannedCheck.mode: "block"` no longer rejects a file write before it happens. Block mode now works at the Stop hook for files, and still denies `gh`/MCP publishing before the call runs. `exclude`, `include`, and `additions` moved to CLI-only — scope the hooks' file coverage with `.vale.ini` sections, and ship custom terms as Vale rules or a vocabulary `reject.txt`. Upgrading from 0.1.x: `bannedCheck.tools` is gone — the hook wiring is fixed at install, so no config field can widen coverage.

### Single-prompt runs (CI)

Non-interactive runs (for example `anthropics/claude-code-action`) submit one prompt and end. These behaviors matter there:

- `reply.mode: "warn"` delivers nothing in a single-prompt run: its report rides the next prompt, and there is none. Use `block` when the reply must pass. Otherwise set the reply check to `off` and let `files` and `publish` cover the text, which is where CI output lives.
- `rules.onContextStart: ["startup"]` injects the rules once at the start, which is all a single-prompt run needs.

To run CI stricter than developers' machines, commit a config for it and point the forced layer at that file:

```yaml
env:
  JUST_SAY_SO_FORCE_CONFIG: ${{ github.workspace }}/.github/just-say-so.ci.json
```

```json
{
  "rules": { "onContextStart": ["startup"] },
  "files": { "mode": "warn" },
  "reply": { "mode": "block" }
}
```

Fields the forced file sets win over the project file, so a mode committed to `.just-say-so.json` can never weaken the CI policy. Fields it leaves out fall through normally.

### The rules manifest

[rules/manifest.json](rules/manifest.json) is the one source for the rules. `npm run build` renders [rules/full.md](rules/full.md) and [rules/condensed.md](rules/condensed.md) from it and generates the `JustSaySo` style, and a test fails when any of the three drift. Each rule carries:

- `full`, the text in the full rules, and `short`, the text in the condensed reminder. A rule without `short` appears in the full text only. `condensed` at the top of the file lists the ids in reminder order.
- `vale`, the Vale rules that check it. An empty list marks a judgment rule such as "lead with the answer" that no linter sees. The full text names them after each bullet, as "Checked by".
- `style`, on the four banned-term rules: the name, message, level, and terms of the generated Vale rule. The `{terms}` placeholder in the text renders that list, so the rules text and the style never disagree about what is banned.

**What the `vale` field buys.** At every context start, the plugin runs `vale ls-config` for the reply target and adjusts the condensed text before injecting it. A bullet is left out when every installed Vale rule behind it is turned off; a rule from a style the project never installed does not count. Error-level rules in the project's styles that no bullet names are added as one closing line, twelve at most, so the model at least sees their names. A project that sets `JustSaySo.Intensifiers = NO` and runs `ai-tells.EmDashUsage` at error gets a reminder without the intensifiers bullet and with the em-dash rule named at the end. When `vale` is missing the text goes out unadjusted.

### Bring your own rules

You might hate my rules, fair enough. Two routes:

- `rules.extra` names a manifest fragment, a JSON file with `sections` of rules in the shape above, which the plugin appends to the shipped manifest. Its rules with a `short` text join the reminder after the shipped ones. This is the place for a bullet about a rule your own Vale style enforces.
- `rules.manifest` replaces the shipped manifest with your own. The generated style still ships the shipped terms; put your own terms in a Vale style of your own and set `JustSaySo = NO` in `.vale.ini` where you disagree.

All the hooks, commands, and config machinery stay the same.

### Bring your own voice

When the checker warns or blocks, it speaks in shipped English sentences (the violation report, the rewrite instruction, the confirmation prompt). Those sentences live in [rules/messages.json](rules/messages.json). To reword them, or to run the enforcement side in another language, copy that file, edit the sentences you want, and point `rules.messagesPath` at your copy. Sentences you leave out keep the shipped wording. The `{target}` placeholder is filled at runtime with the name of the file being checked.

The per-term hints ("use a concrete verb...") and the rules text live in [rules/manifest.json](rules/manifest.json). A full translation edits both files.

### Exemptions

The rules permit a buzzword "when it has precise meaning or is relevant to the domain." A linter cannot make that judgment, and the model would argue its way through it. Whether a term is a real domain term is a fact about your project, and the exemption belongs to your project. The `/just-say-so:allow` command stores it in the right place:

`/allow` appends the term to the vocabulary's `accept.txt`, under the `StylesPath` and `Vocab` that the nearest `.vale.ini` names. When the ini lacks those keys, the command adds `StylesPath = styles` and `Vocab = Project` first. Without a `.vale.ini` the command stops and says so, because the shipped fallback config is not a file to write into. Vale adds every accepted entry to the exception list of every active rule, across all styles. So "robust regression" passes any rule while bare "robust" stays flagged. I verified this against Vale 3.24. The same file serves the editor, the commit hook, CI, and the hooks, so there is no second place to look.

Two Vale facts to know when you edit `accept.txt` by hand. An entry is a case-sensitive regular expression, so `robust regression` does not cover `Robust regression` at the start of a sentence. Run `/allow` once per spelling, or write `[Rr]obust regression` by hand when you need both. `/allow` compares entries exactly for the same reason. And a rule with `nonword: true` ignores the vocabulary. The JustSaySo rules are generated without it for that reason, and a rule of your own that sets it will not honor your exceptions.

In block mode, the rejection message tells the model to suggest the `/just-say-so:allow` command to you, quoting the collocation as it appears in the text.

The hooks also confirm policy edits. When the model edits `.just-say-so.json`, a `.vale.ini`, a vocabulary `accept.txt`, or the global config through the file tools, the hook returns `permissionDecision: "ask"`. You get a confirmation prompt before the edit applies. The vocabulary is the model's easiest self-exemption, so it gets the same prompt. The prompt gives you visibility. A shell command can write the same file without one, so the prompt is no security control.

## Limits (it's not perfect, y'all)

- Vale is markup-aware: code blocks and inline code in Markdown never match a rule. A file format Vale cannot identify scans as plain text, where a banned word in a string literal still flags; exempt those paths in `.vale.ini`.
- The edit-scoped feedback locates an `Edit` by searching for its `new_string` in the written file. A string that repeats yields the union of candidate ranges — extra facts, never a miss. A `Write` that replaced a file has nothing to diff against, so the whole file counts and the message says so.
- The checker never scans for may/might/could. The rules allow bare modals when they state real uncertainty or permission. The banned hedge frames are phrases. The checker catches the ones in its phrase list, and the remaining frames appear to the model only in the rules text.
- The violation-triggered injection depends on the harness delivering `UserPromptSubmit` events. Subagent turns never see it, and that is deliberate: each subagent gets its own copy of the rules at spawn instead.
- This repo's own docs and tests quote the banned words, and its `.vale.ini` turns every style off for those paths. Expect the same in any repo that documents its style rules.

## Other harnesses

The hook protocol of Claude Code (JSON on stdin, JSON on stdout, exit 2 blocks) became the de-facto convention across coding agents. The core logic therefore carries over, but each harness still takes work to adapt. Codex delivers file edits as patches, Copilot drops prompt-hook output from config files, Gemini renames the events. [adapters/README.md](adapters/README.md) maps the verified per-harness constraints and the adapter contract.

### What works where

Only the Claude Code adapter exists today. This table shows what each harness's hook system can support once someone builds an adapter. I checked it against vendor docs on 2026-09-20. "Untested" means the docs neither confirm nor deny it. ⚠️ The rows describe the pre-Vale checker design (0.2.x). The Vale engine moves file blocking to the Stop hook and adds a PostToolUse run. Re-verify the relevant events per harness before building an adapter.

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

The big sacrifices: Copilot loses per-prompt reminders, the plugin's core feature, so rules arrive once per new session and then decay. Codex loses the config confirmation and needs patch parsing before the banned gate functions.

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
