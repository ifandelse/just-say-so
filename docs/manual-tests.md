# Manual test plan

Live verification of the installed plugin. The unit suite proves the scripts produce correct JSON; these tests prove the harness delivers the JSON where we think it does.

Run `scripts/verify-installed-plugin.sh` first: it replays the plugin-logic layer (26 checks, including the live-run fixes) against the installed copy in seconds. The scenarios below then cover only what a script cannot — hook firing, dialogs, context landing in transcripts.

## How to observe what happened

Injected context is invisible in the normal UI, so every scenario names its ground truth:

- **Ask the model.** "What communication rules are you following? Quote their heading." A briefed model quotes `## Communication rules — reminder`.
- **Grep the transcript.** Sessions live under `~/.claude/projects/<encoded-cwd>/`. Each hook run produces TWO records: a `hook_success` log entry holding the hook's raw stdout (diagnostics, not delivered to the model) and a `hook_additional_context` entry (the actual delivery). The model's replies can also quote the rules heading. So count deliveries, not the heading:
  `grep -c '"type":"hook_additional_context"' <session>.jsonl`
- **Read the state file.** Claude Code sets `CLAUDE_PLUGIN_DATA`, so state lives at `~/.claude/plugins/data/just-say-so-just-say-so/state/sessions/<session-id>.json` (confirmed live; the `~/.local/state/` path is the fallback for harnesses without that variable).
- **Watch hooks fire.** `claude --debug` prints hook execution lines.

Facts the 2026-09-20 run established about Claude Code's recording:

- A deny does NOT produce hook records — the reason arrives as the blocked call's tool result. Grep for `just-say-so: banned terms` instead.
- `/clear` mints a NEW session id. Counters "reset" because the new id starts fresh state; the old state file is orphaned until the cleanup sweep.
- Subagent transcripts live at `<project dir>/<session-id>/subagents/agent-*.jsonl`. The `SubagentStart` briefing delivery appears there, not in the main session file.
- Silent hook runs (no output) leave no transcript records at all.

Config changes apply on the next hook fire — `loadConfig` runs per invocation, so editing `.just-say-so.json` mid-session works without a restart. Use `/clear` between phases to reset counters cleanly.

## Phase 0 — preflight

1. Make a scratch project: `mkdir -p ~/tmp/jss-test && cd ~/tmp/jss-test && git init -q`.
2. Check whether `~/.config/just-say-so/just-say-so.json` exists. If it does, note its contents — project config must override any key it sets, or a phase below will behave differently than written.
3. Start `claude` in the scratch dir. Confirm the five events are registered *by this plugin*, using any of these, easiest first:
   - `/plugin` → select just-say-so → the "Installed components" section lists the hook events the plugin registered. Expect all five: `UserPromptSubmit`, `PreToolUse`, `SessionStart`, `SubagentStart`, `Stop`.
   - `/hooks` → each entry shows the command it runs; the just-say-so entries contain the plugin's cache path (`.../plugins/cache/just-say-so/.../src/hooks/<name>.js`).
   - `claude --debug` → send one prompt and watch the debug output print each hook execution, command included. This also proves the hooks fire, not just that they're registered.
4. **(0b)** After your first prompt, locate the session state file (see above). Record where it landed — this tells us which env vars the installed plugin actually receives.

## Phase A — defaults (no project config)

**1. Startup injection.** First prompt in a fresh session: ask what communication rules the model is following. Expect the condensed heading quoted back. Ground truth: transcript grep count = 1.

**2. Warn mode (default).** Ask: "Write notes.md containing exactly: We leverage robust synergy to streamline everything." Expect: the file IS written (warn does not block), and the model sees the violation list — it will typically acknowledge the feedback or offer a rewrite. Ground truth: file exists with the banned text; transcript contains `just-say-so: banned terms in notes.md`.

**3. Default excludes.** Ask the model to add `"robust-websocket": "^1.0.0"` to a `package.json`. Expect: no warning at all — the file is excluded and the hyphenated name would not match anyway.

**4. Reminder cadence (default 5).** Send trivial prompts and after the 5th, check the transcript grep count incremented. Faster version: skip to Phase B where the interval is 2.

## Phase B — project config: fast interval + block mode

Create `.just-say-so.json` in the scratch dir:

```json
{
  "reminder": { "everyPrompts": 2 },
  "bannedCheck": { "mode": "block" }
}
```

Run `/clear` to reset the counter (this also re-injects the rules — that's scenario 5).

**5. `/clear` re-injection.** After `/clear`, ask what rules the model follows. Expect the heading again. Ground truth: state file shows `promptCount` reset.

**6. Two-prompt reminder.** Send two trivial prompts. Ground truth: transcript grep count grows by one on the second; state file `promptCount` is even.

**7. Block + rewrite.** Repeat the scenario-2 request. Expect: the write is DENIED, the model reports the violation list, rewrites clean text, and retries. The deny message suggests `/just-say-so:allow "<collocation>"` to you. Ground truth: final file contains no banned terms.

**8. Edit scope.** With `notes.md` still containing banned words from scenario 2 (recreate by hand if needed), ask the model to append one clean sentence. Expect: no block — only added text is checked.

**9. The allow flow.** Run `/just-say-so:allow "robust regression"`. Expect: no permission prompt (the skill pre-approves its own CLI call — if a prompt appears, `${CLAUDE_PLUGIN_ROOT}` did not expand in frontmatter; note it). Ground truth: `.just-say-so.json` gains `bannedCheck.allowPhrases: ["robust regression"]`. Then ask for a file containing "We fit a robust regression model." — passes. Ask for "a robust pipeline" — blocked.

**10. The ask gate.** Say: "Add 'synergy' to disableWords in .just-say-so.json." Expect: a confirmation prompt citing just-say-so before the edit lands, even if you're in auto-accept mode. Approve it; verify the file.

## Phase C — token mode

Edit `.just-say-so.json`: `"reminder": { "mode": "tokens", "everyTokens": 3000 }`. Run `/clear`.

**11. Token threshold.** Prompt 1 sets the baseline (silent). Then ask the model to read a few large files to grow context past 3,000 tokens, and send another prompt. Expect the reminder. Ground truth: state file's `contextAtLastReminder` jumps to the new context size.

## Phase D — subagents (resolves an open question)

**12. Subagent briefing.** Ask: "Use a subagent to write summary.md describing this folder." Ground truth: grep the *subagent's* transcript (the additional `.jsonl` files in the same project directory) for the reminder heading. **This is the live test of whether `SubagentStart` honors `additionalContext` — the docs truncate before its output schema.** If the heading is absent from the subagent transcript, the injection is ignored and we fall back to briefing on first `PreToolUse`.

**13. Subagent enforcement.** Ask a subagent to write a file containing "seamless synergy". Expect the same block/deny behavior as the main agent — `PreToolUse` fires inside subagents.

## Phase E — chat reply check (off by default)

Edit `.just-say-so.json`: add `"outputCheck": { "mode": "block" }`.

**14. Stop gate.** Say: "Reply with exactly this sentence: we leverage synergy." Expect: the model finishes, the Stop hook bounces the reply with the violation list, and the model continues with a rewrite. It will not loop — the hook ignores its own rewrite pass. Note the UX; this is why the feature ships off.

**15. Warn queue.** Switch `outputCheck.mode` to `"warn"`, repeat. Expect: the reply stands, and your NEXT prompt gets the queued note injected (transcript grep: `your last reply contains banned terms`).

## Phase F — published text via gh (0.2.0)

Edit `.just-say-so.json`: `{ "bannedCheck": { "mode": "block", "addons": ["gh"] } }`. The scratch repo has no GitHub remote, so even a command that slips past the gate cannot publish anything — it fails on "no such remote" instead. Preflight: `claude --version` must be ≥ 2.1.85 for the `if` filter in the hook wiring to apply; on older versions the hook fires on every Bash command, which changes the cost, not the outcome, of these scenarios. (MCP coverage needs a connected server — verify opportunistically in a real project.)

**16. Plain-form control.** Ask: "Run this command: `gh pr comment 42 --body \"We leverage robust synergy.\"`". Expect: DENIED before execution, with `gh pr comment` named in the violation list. Ground truth: `claude --debug` shows check-banned firing for the Bash call; the transcript contains `just-say-so: banned terms in gh pr comment`. This control must pass before scenario 17 means anything — if it fails, the addon config or the hook wiring is broken, not the heredoc handling.

**17. Heredoc-piped form.** Ask the model to run:

```
cat <<'EOF' | gh pr comment 42 --body-file -
We leverage robust synergy.
EOF
```

**This is the live test of whether the harness's `if: "Bash(gh *)"` filter matches a pipeline whose gh command follows a heredoc — the docs say subcommands in pipelines are parsed, but never show a heredoc example.** Expect: DENIED, same as the control — once the hook spawns, the in-hook trigger matches `gh pr comment` anywhere in the command text, so the only unknown is whether the hook spawns at all. Ground truth: `claude --debug` shows check-banned firing for this Bash call. If the deny is absent AND the debug output shows no hook execution, the `if` filter dropped the heredoc form: record it, and the fix is choosing between removing `if` from the Bash entry in `hooks.json` (every Bash call pays the spawn, coverage complete) or documenting the heredoc form as a known gap in the README next to `--body-file`.

## Recording results

Mark each scenario pass/fail with the ground-truth evidence.

## Results — 2026-09-20 run (plugin 0.1.1)

12 clean passes; scenarios 12 (subagent briefing) and 9 (skill frontmatter expansion) resolved their open questions affirmatively. Three findings, all fixed in 0.1.2:

1. **Test 8 partial.** Edits that append by anchor-replacement copy the old line into `new_string`, so pre-existing banned words tripped the gate. Fixed: the checker now diffs `old_string`/`new_string` and scans only the added text, widened to word boundaries.
2. **Test 13 fail.** Backgrounded-subagent events carried a `cwd` outside the project; config discovery found nothing and block mode silently degraded to warn. Fixed: config discovery anchors on the written file's own directory, and relative globs measure from the config file's directory.
3. **Test 14 partial.** Stop events carried the same bad `cwd`; the chat check silently loaded no config. Fixed: the prompt hook records the project directory in session state, and the Stop hook falls back to it. Residual: a Stop that fires before any prompt in a session has no recorded directory.
