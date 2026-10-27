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

You also get eight commands. They work in environments without hooks (like desktop apps), and anywhere you want manual control:

- `/just-say-so:init [flags]` — set a project up: a `.vale.ini` that loads the JustSaySo package, `vale sync`, the plugin config for the targets you name, and the commit gate for the repo's hook tooling. See [Setting a project up](#setting-a-project-up).
- `/just-say-so:doctor` — how the plugin reads this project: the Vale binary and config in force, which rules each target lints under, the raw section settings, and every warning. See [The doctor](#the-doctor).
- `/just-say-so:summary [--since 30d] [--project <path>]` — what the plugin has recorded, as facts with their counts: turns, rejections per 100 turns, distance from the last rules injection, the rules that fire and the rules on rejected replies, rewrites, reasons, allows. See [The summary](#the-summary).
- `/just-say-so:advise [--since 30d] [--project <path>]` — what the recurring restate tags point at, turned into recommendations: a Vale setting to change, a judgment bullet to write, or a package to install, matched against the project's installed rules and the package cache. See [Advice](#advice).
- `/just-say-so:packages [--refresh [names]] [--prune]` — the package cache: the rule facts of every writing-rule package in the Vale registry, downloaded when you say so, for advice on packages you do not have. See [Advice](#advice).
- `/just-say-so:draft [--all]` — bullets for the Vale rules this project enforces that the reminder only names, grouped by theme, as a `rules.extra` fragment to paste and edit. See [Bullets for your own Vale rules](#bullets-for-your-own-vale-rules).
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

**Installing it** in a repository: `/just-say-so:init` does it for the hook tooling the repo already has, and prints the step it cannot do itself (a dev dependency install or `pre-commit install`). By hand, by preference:

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

### Setting a project up

Run `/just-say-so:init` in the project. It does four things and prints each one:

1. Writes a `.vale.ini` when the project has none: `StylesPath = styles`, `Vocab = Project` with an empty `accept.txt`, the JustSaySo package pinned at the plugin's version, and `[*] BasedOnStyles = JustSaySo`. When a `.vale.ini` exists, it pins the package and adds the two keys only if they are missing, and never touches your sections.
2. Runs `vale sync`.
3. Writes `.just-say-so.json` for the flags you gave, merged over an existing file: `--files`, `--publish`, `--reply` take `off|warn|block`; `--gh` turns on the gh check; `--mcp <pattern>` names an MCP tool pattern and repeats. No flags means the defaults apply and no file is written.
4. Wires the commit gate. `--hook auto` (the default) picks the pre-commit framework when `.pre-commit-config.yaml` exists, Husky when `.husky/` exists, a plain `.git/hooks/pre-commit` when the repo has a `package.json`, and otherwise prints the pre-commit snippet. The framework config is never edited; the snippet is printed for you to add. The Husky and plain-git hooks run `node_modules/.bin/just-say-so-staged`, so the dev dependency install the output names is the step you run yourself.

`--dry-run` prints every step without writing. The doctor report follows every run.

### The doctor

`/just-say-so:doctor` prints the setup facts, then one line per target with, for each style, how many of its rules are on, then how many of the rules that are on sit at each level, then any rules of a selected style that are off, then the raw section settings in the order Vale applies them, then the warnings. The target lines are the plugin's reading of the Vale config, the same reading the context-start reminder uses, and the raw settings sit beside them so you can check that reading against the config when they disagree. Warnings cover: a missing or wrong `vale` binary, 0.8.x keys in a config file, no `.vale.ini` above the directory, the package pinned at a different tag than the plugin, packages listed but not synced, a `Vocab` that names a missing vocabulary (Vale stops with E100 until it exists), the `reply` and `publish` formats not mapped, a leftover `chat.md` section, a section that restates `BasedOnStyles`, a section whose path list names files that no longer exist, the JustSaySo style installed but selected nowhere, and a target in block mode with no error-level rule. The command exits 1 when there are warnings, so a script can gate on it.

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

Restate exists to record where just-say-so failed you, so the records can show what to change. That change takes one of three shapes, and only the first touches Vale: tune a Vale rule (its level, a term, an allowed collocation); add or edit a judgment bullet in the rules file, for a failure no linter can see; or write a new Vale rule, when the failure turns out to be checkable. The judgment bullets are not a fallback. They cover what Vale cannot, and the manifest holds them beside the linted ones with an empty `vale` list.

**Tags.** A `#word` anywhere in the reason is a tag: `/just-say-so:restate #undefined-term what is a "pin"?` stores the tag `undefined-term` and the reason as typed, hash included. Tags are whatever you type; there is no list to pick from. The summary counts them, and when a tag is the id of a bullet in the rules file, the summary says whether that bullet is a judgment bullet or a Vale-backed one and how often its rules fired on the replies you rejected. Each rejection is checked against the rules file of its own project, including that project's `rules.extra`, so a tag that one project covers and another does not prints once per coverage with the projects named. A tag that matches no bullet is reported under "what the rules do not cover yet", which is the list of bullets and rules still to write.

The plugin records each rejection. The prompt hook reads the rejected reply from the transcript, so the text is what the model wrote and not what it remembers writing. It lints that text at every Vale level and appends one JSON line to `rejections.jsonl` in the state directory: `$CLAUDE_PLUGIN_DATA/state` under a plugin install, otherwise `~/.local/state/just-say-so`. The Stop hook adds the rewrite and its alerts to the same line when the turn ends. In `block` mode a rewrite that the gate rejects is not the one saved; the record closes with the reply the gate lets stand. The rejected reply's own `warn` counts go with the record instead of riding the next prompt, so a later report describes the rewrite and not the reply you already rejected. A record holds the session id, the project directory, the prompt index, the reason as typed and its tags, both texts with their alerts, the plugin version, and the settings in force. Replies can quote code, logs, paths, and customer data, so the file stays on your machine. Nothing writes it into a project or sends it anywhere.

What the file is for: a rejected reply that Vale passed points at a missing rule, a level set too low, or a judgment bullet still to write. A reason or tag that recurs suggests a bullet needs different wording, or needs to exist. Rejected and rewritten pairs form a test set for any judge that scores replies against the rules. Rejections divided by prompts is a drift rate for one user's sessions, which compares reminder settings for that user. These records tune your configuration. They do not fine-tune a model.

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

### The summary

`/just-say-so:summary` reads both files and prints facts with their counts. A **turn** is a reply event whose outcome is `pass` or `standdown`; a `block` line is an attempt and is counted apart, and no count comes from a prompt index, which resets on compaction and `/clear`. A **rejection** is a record in `rejections.jsonl`, which exists even with the events log off. **Unlinted** means `alerts` was `null`, and never counts as clean or as fixed. Every rate counts only the rejections that join to a turn inside the window, the turn one prompt before the restate in the same session, so a rejection from a session the log never saw, or one whose rejected turn precedes the window, appears in the raw counts and in no rate. A rate prints only when its denominator is in the window; otherwise the line says it is unavailable. A reply's mode is the session setting in force when the reply happened, so a compaction that changed the mode counts from that point on.

The sections: the window and its sessions; volume; rejections per 100 turns, overall, per project, and per week once the window spans a month; rejections per 100 turns in each distance bucket from the last rules injection, which is association only, because a violation itself resets the distance; the rules with an error on final replies, with their top terms and the reply mode of those sessions; the rules on rejected replies by level, the rejected replies Vale passed clean with their reasons, and the ones that carried only warnings; rewrites that came back clean, kept an error, or were unlinted, and the rules that survive a rewrite; the reasons you typed, grouped; the tags, each with what covers it, a judgment bullet, a Vale-backed bullet with how often its rules fired on those replies, or nothing yet; what each recurring tag points at, described below; allows by term and project; sessions per setting. The report ends with observations stated with their counts and what the data does not establish. It recommends nothing; `/just-say-so:advise` does.

**What the tags point at.** A tag with 3 or more rejections in one project lands in one situation, decided in this order. *Uncovered*: no bullet has the tag as its id, which points at a judgment bullet or a Vale rule. *Judgment*: a bullet with no Vale rules covers it, and the line says whether the bullet has a `short` text, since only bullets with one are in the condensed reminder, and only a Vale alert re-injects the rules. For a Vale-backed bullet, two kinds of alert count, and the report labels them: *restate-time* alerts come from `/restate` linting the old reply under the config in force then, and show whether the rules detect the problem; *ship-time* alerts come from the reply event the rejection joined to, and show what happened when the reply went out. *Insufficient*: fewer than 3 linted rejected replies, or no joined reply that was linted, so the line gives the counts and no diagnosis. *Stood down*: the rules fired at ship-time and every such turn was the block gate standing down, which is the gate's own escape when a rewrite keeps the same alerts; blocking and the level were in force, so the line points at the rule or the bullet, not at a setting. *Fired, still shipped*: the rules fired at ship-time and the reply went out, with the reply mode and levels in force and any stood-down turns counted, which points at `reply.mode = block` or the rule at error level. *Silent*: the rules caught fewer than half of the linted rejected replies at restate-time and none at ship-time, which points at a Vale tune. *Detects now*: the rules catch half or more at restate-time and fired on none at ship-time, so they were off or lower then. Rejections with no tag that Vale passed clean are listed per project with their reasons, so they can be tagged in one pass. The threshold applies within one project; the same tag twice in one project and once in another earns nothing.

`--since` takes an ISO date or a span such as `30d` or `6w`, `--project` narrows to one project path, and `--json` prints the object the text is rendered from. The report prints rule names, shipped terms, counts, project paths, and your typed reasons. It never prints a prompt or a reply.

### Advice

`/just-say-so:advise` runs `node src/cli/advise.js`, which prints the advice inputs, and the model writes one recommendation per situation from them: the project and tag, the counts, and a ready-to-paste change, which is a `.vale.ini` line, a `rules.extra` bullet in the shape `/draft` produces, or a `Packages` line with `vale sync` and the `BasedOnStyles` addition for the reply section. The model names only rules and packages the inputs printed.

The inputs, per project in the report: the situations; for each rule a situation's bullet names, whether it is installed and on for the reply target and at what level, read with the same rule-state resolution the reminder uses; a **shortlist** of candidate rules per tag; the project's `Packages` entries and the reply section's `BasedOnStyles`; and the registry packages the project does not have, with their descriptions. The shortlist scores every candidate rule by word overlap between the tag and its typed reasons on one side and the rule's id and message on the other, ids split on capitals and dots, plurals folded, and prints the top ten at or above a floor with the score and the matched words. The pool is the rules installed under the project's styles path, read from disk, plus the rules in the package cache for packages the project has not installed; an installed rule is listed once, from disk. An empty shortlist means this search found nothing, which the text says, not that no rule exists.

**The package cache.** The Vale registry, `library.json` in [vale-cli/packages](https://github.com/vale-cli/packages), is the list Vale resolves a bare `Packages` name from: 27 entries in October 2026, each with a name, a one-line description, a release URL, and a `tags` list, where `style` marks writing rules and `config` marks markup support with no rules. Advise fetches it live with a 3 second timeout and falls back to the copy shipped at `rules/vale-library.json`; `JUST_SAY_SO_REGISTRY=shipped` skips the fetch. Descriptions alone sort a tag into a category, not onto a rule, so `/just-say-so:packages --refresh` downloads every style package's archive (about 3 MB from the packages' GitHub release pages), reads each rule's id, level, what it extends, message, link, and a sample of its tokens, and writes one JSON file per package under `packages/` in the state directory. Nothing else downloads an archive: advise reads the cache and says when it is empty or older than 30 days. An archive is read in memory, only its `.yml` entries are looked at, and nothing from it is written out or run. A failed download keeps the package's previous file, and a message the single-line parser could not read is counted and reported. `/just-say-so:packages` with no arguments reports the cache against the registry; `--prune` removes packages the registry dropped. The doctor prints the cache size in one line. Packages outside the registry are under the GitHub topic [vale-linter-style](https://github.com/topics/vale-linter-style), which the advice names as a place to look.

### Checking published text (gh and MCP tools)

The file gate catches what the agent writes to disk. PR comments and Confluence pages go out through `gh` commands and MCP tools instead, and by default nothing checks them. These opt-in settings cover them:

`"publish": { "gh": true }` covers the gh commands that publish prose: `create`, `comment`, `edit`, and `review` under `gh pr`, `gh issue`, and `gh release`, plus `gh api` calls that write a prose field: `-f`/`-F`/`--field`/`--raw-field` with the key `body`, `title`, `description`, or `notes`, a nested key such as `comments[][body]`, or a `--input` JSON file that holds one of those keys at any depth. A review with inline comments has to go through `--input`, and each comment lints as its own fragment, labeled by its path in the file (`--input comments[3].body`). When one of those appears anywhere in a Bash command, compound commands included, the checker extracts the text the command publishes and lints only that. It lints the `--title`, `--body`, and `--notes` values, and the contents of a `--body-file`, `--notes-file`, or `@file` reference, read at check time. Each value is its own fragment with its own line numbers. The checker never lints the command string itself. Flags and paths are shell syntax, and a punctuation rule would read `--body` as prose and deny every flagged command.

A value the extractor cannot read is **unresolved**: a `$(...)` substitution, a variable, backticks, stdin, a heredoc, or a `gh api --input` file that is not JSON. The checker refuses to guess what the shell will produce. `publish.unresolved` decides what happens in block mode. `"ask"` (the default) raises a permission prompt that names the construct. `"allow"` lets the call through with an "Unchecked values" note in the hook output. `"deny"` rejects the call. Under a harness permission mode that answers prompts automatically (`bypassPermissions`, `dontAsk`, `auto`), a configured `"ask"` acts as `"allow"`. A prompt nobody answers is a deny in a headless run, and that false deny is worse than a visible warning. Headless pipelines that want strictness set `"unresolved": "deny"`, typically through `JUST_SAY_SO_FORCE_CONFIG`.

`"publish": { "mcp": ["mcp__confluence__*", "mcp__jira__*"] }` names the MCP tools to check, with `*` wildcards. On a matching call, the checker lints every string argument that holds whitespace, nested fields included, as its own fragment. A string without whitespace is an id, a key, or a URL, and is skipped. You name the tool; you never have to know which argument carries the body. Each fragment lints as `mcp.<server>.<tool>.<field>.publish`, where the field is the leaf key (`mcp.jira.create_issue.description.publish`), so a `[mcp.jira.*.publish]` section applies to every Jira field and a `[*.title.publish]` section to titles alone.

`"publish": { "artifact": true }`, the default, checks the page the `Artifact` tool publishes. The hook reads the page at `file_path` before the call and lints it as `artifact.<file>` with its own extension (`artifact.report.html`), so Vale parses HTML as HTML and a `[*.html]` section applies, and an `[artifact.*]` section can single artifacts out. Reads, listings, opens, deletes, and asset uploads are not publishes and pass untouched. A page the hook cannot read is unresolved, like a `gh` value it cannot read.

Each value lints as its own fragment, named `gh.<subcommand>.<field>.publish` for a gh command (`gh.pr.body.publish`, `gh.api.body.publish`) and `mcp.<server>.<tool>.<field>.publish` for an MCP field. The `[*.publish]` section of your config applies, and a narrower glob such as `[gh.*.title.publish]` applies to one field — lexical rules judge a fragment fine, document-level rules do not.

Timing matters more here than at file writes. In `block`, the hook denies the call before the tool runs, so GitHub never receives a flagged comment. This is the one place the plugin still blocks before an action instead of gating at Stop, because no later gate can un-publish. In `warn`, the call proceeds, the text goes out, and the agent gets the report after the fact. If you turned this on because your agent publishes, use `block`.

Known gaps, on purpose:

- `gh api` is covered only through the prose keys above. A string under any other key, in a field or an `--input` body, goes out unchecked.
- An MCP field whose prose has no whitespace, a one-word title say, is skipped as an id.
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

### Bullets for your own Vale rules

A project that runs a style the shipped manifest does not describe, ai-tells say, gets those rules named at the end of the reminder and nothing more. `/just-say-so:draft` writes the missing bullets. It runs `node src/cli/undescribed.js`, which lists every enabled error-level rule for the reply target that no bullet names, with the rule's message, description, link, and a few of the tokens it looks for. The model then groups those rules by theme and writes one bullet per theme, with a `short` text for the reminder, a `full` text, and the grouped ids in `vale`, and prints the result as a `rules.extra` fragment. It is a draft: save it, edit it, and point `rules.extra` at the file. From then on the reminder carries your sentences instead of the names. `--all` includes warning and suggestion rules. The doctor warns when a pasted bullet names a rule no installed style has.

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

The hook protocol of Claude Code (JSON on stdin, JSON on stdout, a deny or a block in the output) became the convention across coding agents, and every harness below has most of the events the plugin needs. The logic in `src/lib/` assumes no harness; only the shims in `src/hooks/` and the `hooks.json` wiring are Claude Code's. [adapters/README.md](adapters/README.md) records the contract an adapter has to meet and the per-harness constraints.

### What works where

Only the Claude Code adapter exists. The table says what each harness's documented hook surface can carry for the current design. I checked it against the vendor docs on 2026-10-27; "untested" means the docs neither confirm nor deny it. Three rows need no hooks at all, because they are Vale and a CLI: the commit gate, `/init` and `/doctor`, and the config-adjusted reminder text.

| Feature | Claude Code | Codex | Cursor | Copilot CLI | Gemini CLI | OpenCode | AGENTS.md only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rules at context start: startup, resume, clear, compaction | yes | yes¹ | partial — `sessionStart` injects, no source, nothing after compaction² | partial — `sessionStart` has a source, nothing after compaction³ | partial — `SessionStart` has a source, `PreCompress` is notification-only | partial — a system-prompt transform keeps the rules on every request⁴ | partial — static file |
| Rules injected into subagents | yes | yes⁵ | **no** — `subagentStart` can deny, not inject | yes — `subagentStart` `additionalContext` | **no** — no subagent events | untested | no |
| Rules plus the violation report on the next prompt | yes | yes — `UserPromptSubmit` `additionalContext` | **no** — `beforeSubmitPrompt` can block, not inject | partial — config hooks cannot inject on the prompt event; `userPromptTransformed` rewrites the model-facing prompt⁶ | yes — `BeforeAgent` `additionalContext` | partial⁴ | no |
| Reply check: read the final reply, block for a rewrite | yes | yes — `Stop` carries `last_assistant_message` | partial — `afterAgentResponse` reads the text; only `stop` can push a follow-up turn | partial — `agentStop` blocks but hands over a transcript path, not the text | yes — `AfterAgent` has `prompt_response` and a deny that retries | partial — `session.idle` is an event; the reply comes through the client, and nothing blocks | no |
| File check after a write, facts into context | yes | partial — `PostToolUse` injects, but edits arrive as `apply_patch` patches to parse⁷ | yes — `postToolUse` `additional_context` | yes — `postToolUse` `additionalContext`; tool names differ | yes — `AfterTool` `additionalContext` | yes — `tool.execute.after` appends to the tool output | no |
| Stop gate for files in block mode | yes | yes — `Stop` with `stop_hook_active` | partial — `stop` `followup_message` | yes — `agentStop` `decision: block` | yes — `AfterAgent` deny | **no** — nothing blocks at idle | no |
| Publish gate before `gh`, MCP, and the artifact page: deny with the text in hand | yes | partial — `PreToolUse` denies; `ask` is parsed but not supported, so unresolved values need `publish.unresolved` set | yes — `beforeShellExecution` and `beforeMCPExecution` allow, deny, or ask | yes — `preToolUse` denies or asks; fail-closed on a hook crash | partial — `BeforeTool` denies; no ask | partial — `tool.execute.before` throws to block; `permission.ask` sets allow or deny | no |
| Confirmation prompt before a policy-file edit | yes | **no** — no ask; deny or allow | **no** — `preToolUse` denies only | yes | **no** — deny only | partial — `permission.ask` | no |
| Commands: `init`, `doctor`, `allow`, `rules`, `remind`, `restate` | yes | yes — skills | yes — skills | yes — skills | partial — TOML commands | partial — command files | no |
| `restate` capture of the rejected reply | yes | untested — needs the prompt hook to read Codex's transcript | no — no prompt-time hook output | untested — transcript format | yes — `BeforeAgent` receives the prompt; the reply needs Gemini's history | untested | no |
| Commit gate, `/init`, `/doctor`, config-adjusted reminder text | yes | yes | yes | yes | yes | yes | commit gate only |

1. Codex `SessionStart` carries `source` with `startup`, `resume`, `clear`, `compact`, and `fork`, and accepts `additionalContext`.
2. Cursor's `preCompact` is observational and `sessionStart` has no source field, so the rules cannot be re-injected after compaction from a hook.
3. Copilot's `preCompact` processes no output.
4. OpenCode's `experimental.chat.system.transform` appends to the system prompt. Rules present on every request covers startup, compaction, and the post-violation prompt at once, at the cost of the report riding a system prompt instead of a user turn.
5. Codex documents `additionalContext` on `SubagentStart`.
6. Copilot's `userPromptSubmitted` output is dropped for config-file hooks; only SDK hooks modify the prompt. `userPromptTransformed` returns `modifiedTransformedPrompt`, which replaces what the model receives, so an adapter could append the rules there. Unverified.
7. Codex delivers edits as patch strings in `tool_input.command`. The adapter parses out added lines before linting, which `edit-ranges.js` does not do today.

Sacrifices by harness: Cursor and Copilot lose the prompt-time re-injection, so the report has to ride the next context start or a tool result. Codex and Gemini lose the confirmation prompt on policy files and fall back to deny or allow. OpenCode has no gate at the end of a turn, so block mode for files and replies does not exist there.

## Development

Runtime code has zero dependencies and runs on Node ≥18. The test stack (vitest 5) is dev-only and needs Node ^22.12, ^24, or ≥26 to run the suite.

```
npm test               # run the suite
npm run test:watch     # watch mode
npm run test:coverage  # enforces 100% line coverage on src/lib/**
```

Test conventions live in [.ai/UnitTestGeneration.md](.ai/UnitTestGeneration.md). Hook logic sits in `src/lib/hooks/` as pure `run(input, env)` functions; the scripts in `src/hooks/` are stdin shims around them, exercised by the integration tests.

### Releases

Every shipped behavior change bumps the version in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — versions are install cache keys. Every released version gets a git tag (`v0.1.2`). `node scripts/refresh-registry.js` refreshes the shipped copy of the Vale registry on demand; the build never fetches it.

Stability promise for vendored copies: within a minor series (0.1.x), import paths and function signatures under `src/lib/` do not change. A script that calls `findViolations()` or `loadConfig()` from a copied tree stays safe across patch upgrades. Before 1.0, a minor bump (0.2.0) may change anything — the tag diff shows what moved.

## License

MIT
