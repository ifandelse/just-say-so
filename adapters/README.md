# Adapters

just-say-so separates payload from delivery. The payload — `rules/*.md`, `rules/banned.json`, and the logic in `src/lib/` — assumes no harness. The Claude Code adapter (`hooks/`, `src/hooks/`, `skills/`) is the first delivery mechanism. This document records what an adapter for another harness needs, based on research verified 2026-09.

## The contract

An adapter provides three behaviors, reusing `src/lib/`:

1. **Periodic injection** — on the harness's prompt-submit event, run the counter/threshold logic (`state.js`, `transcript.js` or the harness's own token data) and inject `readRules('condensed', config)`.
2. **Rules commands** — a user-invocable command that injects `readRules('full' | 'condensed', config)`. `node src/cli/print-rules.js [full|condensed]` prints the resolved text for any command format.
3. **Banned-term gate** — on the harness's pre-tool-use event, run `findViolations(extractedText, loadBanned(config))` and translate the result into that harness's deny/feedback shape.

Config comes from the same files (`~/.config/just-say-so/config.json`, `.just-say-so.json`), so one config drives every harness.

## Landscape

The Claude Code hook protocol (JSON on stdin, `hookSpecificOutput` on stdout, exit 2 blocks) became the de-facto convention. Per harness:

| Harness | Prompt-submit event | Pre-tool-use event | Command format | Adapter cost |
| --- | --- | --- | --- | --- |
| Codex CLI | `UserPromptSubmit` → `additionalContext` | `PreToolUse` → `deny`/`allow` only; `"ask"` is parsed but not supported yet | skills in `.agents/skills/` | Moderate — file edits arrive as `apply_patch` patch strings in `tool_input.command`, so the adapter must parse the patch and check added lines only; the config-confirmation gate degrades without `"ask"`. |
| Cursor | `beforeSubmitPrompt` | `preToolUse` | skills (`.cursor/skills/`) | Wiring, mostly — ships a Claude-format compatibility layer; CLI event coverage still unverified. |
| Copilot CLI | Config-file `userPromptSubmitted` hooks have their output **dropped** — per-prompt injection needs the SDK, or `sessionStart` prompt-hooks (new interactive sessions only, no resume) plus `postToolUse` `additionalContext` | `preToolUse` → `allow`/`deny`/`ask` + `modifiedArgs` (`ask` becomes `deny` under the cloud agent) | skills (`.github/skills/`, reads `.claude/skills/`) | Moderate — no per-prompt injection from config hooks; tool names differ (`create`/`edit`, with a Claude-name mapping) and `toolArgs` shapes are undocumented. |
| Gemini CLI | `BeforeAgent` → `additionalContext` | `BeforeTool` → `decision: deny` | TOML in `.gemini/commands/` | Event-name mapping. Bonus: `AfterAgent` can reject the model's prose — the only first-class chat-text gate in any harness. |
| OpenCode | `chat.message` | `tool.execute.before` (throw to block) | `.opencode/command/*.md` | Small TypeScript plugin wrapping `src/lib/` (Bun runtime, in-process). |
| Everything on AGENTS.md | — | — | — | Static floor: paste `rules/full.md` into AGENTS.md. Session-start only, no periodicity, no gate. |
| Aider | none | none | none | Out of scope — the project is dormant and has no hook mechanism. |

## Known constraints per harness (verified against vendor docs, 2026-09-20)

- **Codex**: `permissionDecision: "ask"` is parsed but not supported — the docs say so explicitly, alongside `continue`, `stopReason`, and `suppressOutput`. Deny/allow work; `updatedInput` and `additionalContext` are documented outputs. File edits are `apply_patch` patches, not `content`/`new_string` fields: `extractText` in the banned-check needs a Codex-specific patch parser that scans only added lines, or context lines around an edit will false-positive.
- **Cursor**: CLI hook-event coverage is not officially enumerated. Confirm `beforeSubmitPrompt` fires in the CLI before relying on it.
- **Copilot**: command and HTTP `userPromptSubmitted` hooks have their output dropped entirely (the docs state this outright; only SDK programmatic hooks can modify the prompt). Periodic injection must ride `sessionStart` prompt-hooks — which fire only for new interactive sessions, not resume — or `postToolUse` `additionalContext`. Hook timeouts fail open, even for policy hooks. `preToolUse` supports `ask`, but the cloud agent downgrades it to `deny`.
- **Gemini**: hooks sit behind `hooksConfig.enabled` in settings.

## Skills travel farther than hooks

Agent Skills (SKILL.md, agentskills.io) is an open standard with 40+ adopters, and several harnesses read each other's skill directories. The `skills/` folder in this repo is already the portable command surface; adapters mostly need symlinks or copies into the harness's expected path.
