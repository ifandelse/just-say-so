# Manual test plan

Live verification of the installed plugin. The unit suite proves the scripts produce correct JSON; these tests prove the harness delivers the JSON where we think it does. Two scenarios (7, 10) also resolve questions the vendor docs left open.

## How to observe what happened

Injected context is invisible in the normal UI, so every scenario names its ground truth:

- **Ask the model.** "What communication rules are you following? Quote their heading." A briefed model quotes `## Communication rules — reminder`.
- **Grep the transcript.** Sessions live under `~/.claude/projects/<encoded-cwd>/`. Each hook run produces TWO records: a `hook_success` log entry holding the hook's raw stdout (diagnostics, not delivered to the model) and a `hook_additional_context` entry (the actual delivery). The model's replies can also quote the rules heading. So count deliveries, not the heading:
  `grep -c '"type":"hook_additional_context"' <session>.jsonl`
- **Read the state file.** The prompt counter lives in `just-say-so/sessions/<session-id>.json`, under `~/.local/state/` — or under the plugin's data directory if the harness sets `CLAUDE_PLUGIN_DATA`. Finding it is itself test 0b.
- **Watch hooks fire.** `claude --debug` prints hook execution lines.

Config changes apply on the next hook fire — `loadConfig` runs per invocation, so editing `.just-say-so.json` mid-session works without a restart. Use `/clear` between phases to reset counters cleanly.

## Phase 0 — preflight

1. Make a scratch project: `mkdir -p ~/tmp/jss-test && cd ~/tmp/jss-test && git init -q`.
2. Check whether `~/.config/just-say-so/config.json` exists. If it does, note its contents — project config must override any key it sets, or a phase below will behave differently than written.
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

## Recording results

Mark each scenario pass/fail with the ground-truth evidence. Failures worth immediate attention: 12 (drives a fallback design), 9's permission prompt (frontmatter expansion), and anything in Phase B (core behavior).
