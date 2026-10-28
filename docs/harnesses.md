# Other harnesses

The hook protocol of Claude Code (JSON on stdin, JSON on stdout, a deny or a block in the output) became the convention across coding agents, and every harness below has most of the events the plugin needs. The logic in `src/lib/` assumes no harness; only the shims in `src/hooks/` and the `hooks.json` wiring are Claude Code's. [adapters/README.md](../adapters/README.md) records the contract an adapter has to meet and the per-harness constraints.

## What works where

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
