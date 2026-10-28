# Adapters

just-say-so separates payload from delivery. The payload is the manifest (`rules/manifest.json`), the `JustSaySo` Vale style generated from it, and the logic in `src/lib/`, none of which assumes a harness. The Claude Code adapter is `hooks/hooks.json`, the stdin shims in `src/hooks/`, and `skills/`. This document records what an adapter for another harness has to provide, verified against the vendor docs on 2026-10-27. The feature table is in [docs/harnesses.md](../docs/harnesses.md).

## The contract

An adapter maps the harness's events onto six functions in `src/lib/` and translates each return value into the harness's output shape. The functions take plain objects and return plain objects; nothing in them reads a Claude Code field.

| Moment | Function | What the harness must supply | What comes back |
| --- | --- | --- | --- |
| Context start, subagent start | `contextRules(config, cwd, env)` in `rule-state.js` | a working directory | the condensed rules, adjusted to the project's Vale config |
| Each prompt | `run(input, env)` in `hooks/remind.js` | `session_id`, `cwd`, `prompt`, and a transcript the `transcript.js` readers understand for `restate` | the rules plus the report when counts wait, else nothing |
| After a file write | `run(input, env)` in `hooks/check-vale.js` | `tool_name`, `tool_input` with `file_path` and the edit's `content` or `new_string` | the edit-scoped alerts, and the error record for the Stop gate |
| Before a publish | `run(input, env)` in `hooks/pre-gate.js` | `tool_name` and `tool_input`: a `command` for gh, the arguments for MCP, a `file_path` for an artifact | a deny, an ask, or advisory context |
| End of turn | `run(input, env)` in `hooks/check-output.js` | `last_assistant_message`, or a transcript path, plus `stop_hook_active` | a block with the alerts, a stand-down, or nothing |
| Commands | `src/cli/*.js` | a command surface that can run `node` | text |

The lint targets are a contract too: a reply lints as `reply.reply`, a published field as `<source>.<tool>.<field>.publish`, and an artifact page as `artifact.<file>`. Keep those names and a project's `.vale.ini` works unchanged under every harness.

Config comes from the same files (`~/.config/just-say-so/just-say-so.json`, `.just-say-so.json`), and the commit gate, `/init`, `/doctor`, and the config-adjusted reminder text need no hooks at all.

## Per-harness constraints

| Harness | Context start | Prompt-time injection | End of turn | Before a tool | After a write | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `SessionStart` with `source` in startup, resume, clear, compact, fork; `additionalContext` | `UserPromptSubmit` `additionalContext` | `Stop` with `last_assistant_message` and `stop_hook_active` | `PreToolUse` with `tool_name`, `tool_input`; deny and `updatedInput`; `ask` parsed but not supported | `PostToolUse` `additionalContext`; edits are `apply_patch` patch strings in `tool_input.command` | `SubagentStart` accepts `additionalContext`. Set `publish.unresolved` to `allow` or `deny`, since `ask` falls through. Needs a patch parser for added lines. |
| Cursor | `sessionStart` with `additional_context`; no source; `preCompact` observational | none: `beforeSubmitPrompt` can only block | `afterAgentResponse` has `text` but no output; `stop` has `followup_message` | `preToolUse` deny only; `beforeShellExecution` and `beforeMCPExecution` allow, deny, ask, with `command` or `tool_input` | `postToolUse` with `additional_context` | `subagentStart` can deny, not inject. The report has to ride a tool result or the next session start. |
| Copilot CLI | `sessionStart` with `source` in startup, resume, new; `additionalContext` | config hooks cannot inject on `userPromptSubmitted`; `userPromptTransformed` returns `modifiedTransformedPrompt` | `agentStop` with `transcriptPath` and `decision: block` | `preToolUse` with `toolName`, `toolArgs`; allow, deny, ask, `modifiedArgs`; fail-closed on a crash | `postToolUse` with `toolResult` and `additionalContext` | Hooks load from `~/.copilot/hooks/`, `.github/hooks/*.json`, and plugins. `subagentStart` prepends `additionalContext`. The cloud agent downgrades ask to deny. |
| Gemini CLI | `SessionStart` with `source` in startup, resume, clear; `additionalContext` | `BeforeAgent` receives `prompt`, returns `additionalContext` | `AfterAgent` receives `prompt_response`; `decision: deny` retries with `reason` | `BeforeTool` with `tool_name`, `tool_input`; deny; no ask | `AfterTool` with `tool_response` and `additionalContext` | No subagent events. Commands are TOML under `.gemini/commands/`. |
| OpenCode | `experimental.chat.system.transform` pushes to the system prompt on each request; `experimental.session.compacting` adds context | `chat.message` sees the message; whether it can append model-visible text is undocumented | `session.idle` event; the reply is read through the client; nothing blocks | `tool.execute.before` with `tool`, `sessionID`, `callID`, `output.args`; throw to block; `permission.ask` sets allow or deny | `tool.execute.after` with `output.output` to append to | A TypeScript plugin on Bun that imports `src/lib/` in process. No subagent hook documented. |
| AGENTS.md only | paste `rules/full.md` | none | none | none | none | The commit gate still works. |

## Skills travel farther than hooks

Agent Skills (SKILL.md, agentskills.io) is an open standard that several harnesses read from each other's directories. The `skills/` folder in this repo is the portable command surface; an adapter mostly copies or links it into the harness's path and rewrites the two that need a different format (Gemini's TOML, OpenCode's command files).
