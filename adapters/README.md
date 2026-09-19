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
| Codex CLI | `UserPromptSubmit` → `additionalContext` | `PreToolUse` → `permissionDecision` | skills in `.agents/skills/` | Wiring only — Codex copied the Claude event names. |
| Cursor | `beforeSubmitPrompt` | `preToolUse` | skills (`.cursor/skills/`) | Wiring only — ships a Claude-format compatibility layer. |
| Copilot CLI | `userPromptSubmitted` | `preToolUse` | skills (`.github/skills/`, reads `.claude/skills/`) | Wiring only — accepts Claude aliases and matchers. |
| Gemini CLI | `BeforeAgent` → `additionalContext` | `BeforeTool` → `decision: deny` | TOML in `.gemini/commands/` | Event-name mapping. Bonus: `AfterAgent` can reject the model's prose — the only first-class chat-text gate in any harness. |
| OpenCode | `chat.message` | `tool.execute.before` (throw to block) | `.opencode/command/*.md` | Small TypeScript plugin wrapping `src/lib/` (Bun runtime, in-process). |
| Everything on AGENTS.md | — | — | — | Static floor: paste `rules/full.md` into AGENTS.md. Session-start only, no periodicity, no gate. |
| Aider | none | none | none | Out of scope — the project is dormant and has no hook mechanism. |

## Known risks per harness

- **Codex**: open issue #19385 — `PreToolUse` `additionalContext` rejected at runtime despite the schema. Deny with a reason works; test the warn path.
- **Cursor**: CLI hook-event coverage is not officially enumerated. Confirm `beforeSubmitPrompt` fires in the CLI before relying on it.
- **Copilot**: hook timeouts fail open, even for policy hooks. The gate is best-effort there.
- **Gemini**: hooks sit behind `hooksConfig.enabled` in settings.

## Skills travel farther than hooks

Agent Skills (SKILL.md, agentskills.io) is an open standard with 40+ adopters, and several harnesses read each other's skill directories. The `skills/` folder in this repo is already the portable command surface; adapters mostly need symlinks or copies into the harness's expected path.
