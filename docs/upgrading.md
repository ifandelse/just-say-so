# Upgrading

## 0.19.0

The JustSaySo package bundles two community styles beside JustSaySo: ai-tells v1.37.0 and STE v0.1.0, pinned by checksum and unchanged. After you update the `Packages` URL and run `vale sync`, Markdown and other prose formats, chat replies, and published text lint under 149 rules instead of six. The plugin's settings for them, 14 rules off and 6 at suggestion, come with the package. Code files keep the banned list and nothing wider. Turn a rule back on with a `= YES` line, or drop a bundled style for one format with a `BasedOnStyles` line in that format's section. [The Vale engine](vale.md) has both recipes. The doctor warns when a project's synced copy of a bundled style has a different rule count from the plugin's.

Eighteen banned terms that a bundled rule already reports left the generated JustSaySo style, which retires `JustSaySo.Leverage` and `JustSaySo.Substitutions`. The rules text still lists every term, and each names the bundled rule that checks it. Every bundled rule that is on is named by a bullet, so the context-start trailer is empty under the shipped config. Punctuation and Claims you can check are new bullets, and the condensed reminder gained both. The summary situation `fired-shipped` is now `matched-shipped`, and `stood-down` is `waived`. The reply event records `waived` where it recorded `standdown`, and the summary reads both. The messages `stopGateStandDown` and `outputStandDown` are now `stopGateWaived` and `outputWaived`. A `rules.messagesPath` file that overrides the old keys overrides nothing until renamed.

`/just-say-so:allow` now lints the term before it writes. Vale ignores `accept.txt` for a rule that sets `nonword`, which 94 of the bundled rules do, so an entry that only such rules would honour is no longer written. The command explains the two ways out instead. The doctor lints each existing entry and warns about the ones that only nonword rules report.

## 0.18.1

A `rules.manifest` path that does not exist or is not JSON no longer leaves a session without rules: every hook falls back to the shipped manifest, session start prints one notice naming the file, and the doctor warns. A hook that throws still exits 0 with nothing on stdout, and now writes one line to stderr and one JSON line to `hook-errors.jsonl` in the state directory. The doctor reports the last 7 days.

## 0.18.0

A file named `.just-say-so-rules.json` in the project root, or in a directory above it, is read as the extra rules file with no setting. `rules.extra` still names any other path and takes precedence when set. An extra bullet whose `id` matches a shipped bullet now replaces it instead of adding a duplicate, and `{ "id": "...", "drop": true }` removes a shipped bullet. An extra file that reused a shipped id by accident changes behavior: the shipped bullet is replaced.

## 0.17.0

A context start and a subagent start now inject the full rules text instead of the condensed reminder, which had gone out at session start since 0.1.2. The bullets with no short text (define a term on first use, the technical-term test, and headings and lists) reach the model for the first time from a hook. The prompt after a violation still holds the condensed reminder. Set `rules.contextStartText` to `"condensed"` to keep the old behavior.

## 0.8.x and 0.9.x

Upgrading from 0.9.x: `rules.fullPath` and `rules.condensedPath` are gone. The rules text renders from [`rules/manifest.json`](../rules/manifest.json). Point `rules.manifest` at a manifest of your own, or add bullets with `rules.extra`. See [The rules manifest](rules.md#the-rules-manifest). Upgrading from 0.8.x: the config is keyed by target now, and there is no compatibility shim. A file that still sets `reminder`, `bannedCheck`, or `outputCheck` configures nothing, and session start names the file and the keys once per session. The table maps the old keys to the new ones:

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
| `reminder.mode`, `everyPrompts`, `everyTokens` | removed in 0.9.0; the rules go out at every context start and on the prompt after a violation, and interval reminders had no measured effect |
| `bannedCheck.disableWords`, `allowPhrases` | the Vale vocabulary; `/just-say-so:allow` writes it |
| `bannedCheck.exclude`, `include`, `additions`, the `check.js` CLI | removed; `.vale.ini` sections scope files, a Vale style or `reject.txt` adds terms, and `vale` itself checks text from scripts |

Chat and published text no longer lint as `*.chat.md`. A `[*.chat.md]` section matches nothing now; rename it to `[*.reply]` or `[*.publish]`, and add the `[formats]` lines or the JustSaySo package so both parse as Markdown. Session start prints one notice while a dead section or the missing mapping remains. Upgrading from 0.2.x: the checker engine is Vale now. `bannedCheck.mode: "block"` no longer rejects a file write before it happens. Block mode now works at the Stop hook for files, and still denies `gh`/MCP publishing before the call runs. `exclude`, `include`, and `additions` moved to CLI-only, scope the hooks' file coverage with `.vale.ini` sections, and ship custom terms as Vale rules or a vocabulary `reject.txt`. Upgrading from 0.1.x: `bannedCheck.tools` is gone, the hook wiring is fixed at install, so no config field can widen coverage.
