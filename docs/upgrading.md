# Upgrading

## 0.18.1

A `rules.manifest` path that does not exist or is not JSON no longer leaves a session without rules: every hook falls back to the shipped manifest, session start prints one notice naming the file, and the doctor warns. A hook that throws still exits 0 with nothing on stdout, and now writes one line to stderr and one JSON line to `hook-errors.jsonl` in the state directory; the doctor reports the last 7 days.

## 0.18.0

A file named `.just-say-so-rules.json` in the project root, or in a directory above it, is read as the extra rules file with no setting; `rules.extra` still names any other path and wins when set. An extra bullet whose `id` matches a shipped bullet now replaces it instead of adding a duplicate, and `{ "id": "...", "drop": true }` removes a shipped bullet. An extra file that reused a shipped id by accident changes behavior: the shipped bullet is replaced.

## 0.17.0

A context start and a subagent start now inject the full rules text instead of the condensed reminder, which had gone out at session start since 0.1.2. Three bullets with no short text (define a term on first use, the technical-term test, and headings and lists) reach the model for the first time from a hook. The prompt after a violation still carries the condensed reminder. Set `rules.contextStartText` to `"condensed"` to keep the old behavior.

## 0.8.x and 0.9.x

Upgrading from 0.9.x: `rules.fullPath` and `rules.condensedPath` are gone. The rules text renders from [rules/manifest.json](../rules/manifest.json); point `rules.manifest` at a manifest of your own, or add bullets with `rules.extra`. See [The rules manifest](rules.md#the-rules-manifest). Upgrading from 0.8.x: the config is keyed by target now, and there is no compatibility shim. A file that still sets `reminder`, `bannedCheck`, or `outputCheck` configures nothing, and session start names the file and the keys once per session. The table maps the old keys to the new ones:

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

Chat and published text no longer lint as `*.chat.md`. A `[*.chat.md]` section matches nothing now; rename it to `[*.reply]` or `[*.publish]`, and add the `[formats]` lines or the JustSaySo package so both parse as Markdown. Session start prints one notice while a dead section or the missing mapping remains. Upgrading from 0.2.x: the checker engine is Vale now. `bannedCheck.mode: "block"` no longer rejects a file write before it happens. Block mode now works at the Stop hook for files, and still denies `gh`/MCP publishing before the call runs. `exclude`, `include`, and `additions` moved to CLI-only — scope the hooks' file coverage with `.vale.ini` sections, and ship custom terms as Vale rules or a vocabulary `reject.txt`. Upgrading from 0.1.x: `bannedCheck.tools` is gone — the hook wiring is fixed at install, so no config field can widen coverage.
