# Review findings — working list

From the external review, 2026-09-19. Working top to bottom, one at a time.

## Standards

- [x] Condensed and full rules disagree: `condensed.md` still says "One word, one meaning, per document"; `full.md` line 22 uses the revised terminology rule. Sync condensed to the revised wording.
- [x] Documented Node requirement is wrong for contributors: `engines` says `>=18` (runtime, correct) but vitest 5 needs `^22.12.0 || ^24.0.0 || >=26.0.0`. Add `devEngines` and a README note.

## Spec

- [x] **Configuration consent boundary is bypassable.** Resolved by right-sizing, not hardening: this is a style linter, so the stance is visibility, not prevention. Bash inspection: won't-do (disproportionate arms race). Kept the Write/Edit `ask` gate, reframed as a courtesy confirmation + deadlock fix. Deny message now suggests `/just-say-so:allow "<term>"` to the user instead of handing the model a node command. README claim replaced with modest wording. Default `bannedCheck.mode` flipped to `warn` (linter convention); `block` is the opt-in hard gate.
- [x] **Output checker may read stale text.** Verified against the hooks reference: "The transcript file is written asynchronously and may lag... Hooks that need the final assistant text of the current turn should use `last_assistant_message` on Stop and SubagentStop." `check-output.js` now prefers `last_assistant_message` (string) and falls back to the transcript for harnesses without the field.
- [x] **Generated exemption command is too broad.** The deny message no longer pre-fills a bare term. It instructs the model to suggest `/just-say-so:allow "<collocation>"` quoting the term as it appears in the text — the model holds the sentence, so it picks the collocation; the CLI already routes multiword input to `allowPhrases`. Hook-side collocation extraction rejected as heuristic bloat.
- [x] **Skills grant `Bash(node *)` for the whole turn.** Both skills narrowed to `Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/print-rules.js" *)`, matching the `allow` skill's pattern. The stale `Read` grant dropped too. If `${CLAUDE_PLUGIN_ROOT}` fails to expand in frontmatter, the grant silently doesn't match and the user gets a normal permission prompt — degrades to asking, never to broader access.
- [x] **Plugin version never bumped.** Not an issue pre-publish: no remote, no marketplace listing, no installations to cache-bust. Policy adopted for release time: once published, bump `plugin.json` (and `marketplace.json`) on every behavior change that ships — versions are install cache keys.
- [x] **Fresh sessions get no rules for four prompts.** Default `onSessionStart` now covers all four sources (`startup`, `resume`, `clear`, `compact`): rules are present at the start of every context, then refreshed every N prompts. `clear` previously reset the counter without injecting, recreating the gap mid-session — fixed by the same change. Users whose CLAUDE.md already carries the rules can trim the list back to `["compact"]`.
- [x] **Adapter map understates work.** Verified against both vendor docs (2026-09-20); the reviewer was right on every count. Codex: `apply_patch` delivers edits as patch strings in `tool_input.command` (adapter needs a parser for added lines), and `"ask"` is documented as parsed-but-not-supported. Copilot: config-file `userPromptSubmitted` hooks have output dropped — injection must ride `sessionStart` prompt-hooks (new sessions only) or `postToolUse`. `adapters/README.md` rows corrected from "wiring only" to honest per-harness costs; the main README claim softened to match.

---

All nine findings resolved. This file can be deleted whenever it stops being useful.
