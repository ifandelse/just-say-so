# Manual test plan

Live verification of the installed plugin. The unit suite proves the scripts produce correct JSON. These tests prove the harness delivers the JSON where we think it does.

Run `scripts/verify-installed-plugin.sh` first: it replays the plugin-logic layer (28 checks, including the live-run fixes and the Vale engine paths) against the installed copy in seconds. The scenarios below then cover only what a script cannot: whether each hook runs, dialogs, and context arriving in transcripts. The checks need `vale` on PATH. The script says so and skips those scenarios without it.

## How to observe what happened

Injected context is invisible in the normal UI. Each scenario names its ground truth, one of these:

- **Ask the model.** "What communication rules are you following? Quote their heading." A briefed model quotes `## Communication rules — reminder`.
- **Grep the transcript.** Sessions live under `~/.claude/projects/<encoded-cwd>/`. Each hook run produces TWO records: a `hook_success` log entry holding the hook's raw stdout (diagnostics, not delivered to the model) and a `hook_additional_context` entry (the actual delivery). The model's replies can also quote the rules heading. So count deliveries, not the heading:
  `grep -c '"type":"hook_additional_context"' <session>.jsonl`
- **Read the state file.** Claude Code sets `CLAUDE_PLUGIN_DATA`, so the state file is at `~/.claude/plugins/data/just-say-so-just-say-so/state/sessions/<session-id>.json` (confirmed live). The `~/.local/state/` path is the fallback for harnesses without that variable.
- **Watch hooks run.** `claude --debug` prints hook execution lines.

Facts the 2026-09-20 run established about Claude Code's recording:

- A deny does NOT produce hook records. The reason arrives as the blocked call's tool result. Denies now come only from the gh/MCP pre-gate; grep for `just-say-so: Vale alerts in text published by` instead.
- `/clear` creates a NEW session id. Counters "reset" because the new id starts fresh state. The old state file is orphaned until the cleanup sweep.
- Subagent transcripts live at `<project dir>/<session-id>/subagents/agent-*.jsonl`. The `SubagentStart` briefing delivery appears there, not in the main session file.
- Silent hook runs (no output) leave no transcript records at all.

Config changes apply on the next hook run. `loadConfig` runs per invocation, so editing `.just-say-so.json` mid-session works without a restart. Use `/clear` between phases to reset counters cleanly.

## Phase 0: preflight

1. Make a scratch project: `mkdir -p ~/tmp/jss-test && cd ~/tmp/jss-test && git init -q`.
2. Check whether `~/.config/just-say-so/just-say-so.json` exists. If it does, note its contents. Project config must override any key it sets, or a phase below will behave differently than written.
3. Start `claude` in the scratch dir. Confirm the six events are registered *by this plugin*, using any of these, easiest first:
   - `/plugin` → select just-say-so → the "Installed components" section lists the hook events the plugin registered. Expect all six: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SubagentStart`, `Stop`.
   - `/hooks` → each entry shows the command it runs. The just-say-so entries contain the plugin's cache path (`.../plugins/cache/just-say-so/.../src/hooks/<name>.js`).
   - `claude --debug` → send one prompt and watch the debug output print each hook execution, command included. This also proves the hooks run, not just that they're registered.
4. **(0b)** After your first prompt, locate the session state file (see above). Record its location. The location tells us which env vars the installed plugin actually receives.

> **0.9.0 note.** The config is keyed by target now (`files`, `publish`, `reply`, `rules`), and the interval reminders are gone. Scenario text below that names `bannedCheck`, `outputCheck`, or `reminder` reads through the README's "Upgrading from 0.8.x" table. Scenarios marked **removed in 0.9.0** have no behavior to test any more.

## Phase A: defaults (no project config)

**1. Startup injection.** First prompt in a fresh session: ask what communication rules the model is following. Expect the condensed heading quoted back. Ground truth: transcript grep count = 1.

**2. Warn mode (default).** Ask the model to write `notes.md` containing exactly `We leverage robust synergy to streamline everything.` Expect: the file IS written (the check runs after the write), the model sees the Vale alerts for its added lines, and you see a one-line summary in the UI (`just-say-so: Vale: 3 error(s)...`). Ground truth: file exists with the banned text. The transcript contains `just-say-so: Vale reports`.

**3. Fallback-config exemptions.** Ask the model to add `"robust": "^2.0.0"` to a `package.json`. Expect: no feedback at all. The shipped Vale config exempts the dependency manifests, and hyphenated names like `robust-websocket` would not match anyway.

**4. Reminder cadence (default 5).** Removed in 0.9.0. Send trivial prompts and after the 5th, check the transcript grep count incremented. Faster version: skip to Phase B where the interval is 2.

## Phase B: project config in block mode

Create `.just-say-so.json` in the scratch dir:

```json
{
  "files": { "mode": "block" }
}
```

Run `/clear` to reset the counter (this also re-injects the rules, which is scenario 5).

**5. `/clear` re-injection.** After `/clear`, ask what rules the model follows. Expect the heading again. Ground truth: state file shows `promptCount` reset.

**6. Two-prompt reminder.** Removed in 0.9.0. Send two trivial prompts. Ground truth: transcript grep count grows by one on the second. The state file's `promptCount` is even.

**7. Block mode: the Stop gate.** Repeat the scenario-2 request. Expect: the write LANDS (block no longer rejects writes), the model gets the alert facts, and when it tries to end the turn, the Stop hook blocks with the outstanding errors until the model fixes the file. Ground truth: final file contains no banned terms. The transcript shows the `decision: "block"` reason naming the file. If the model "fixes" without fixing, the second block repeats; if the alert set is unchanged after a rewrite, the gate reports once (`not blocking again`) and lets the turn end. Note which path you saw. **7a (0.5.2, issue #2).** After the waiver, send two more prompts. Expect: neither turn blocks on the same alert, and the state file holds the file under `waived`. Then ask the model to add a second banned word to the same file. Expect: the gate blocks on the new instance only.

**8. Edit scope.** With `notes.md` containing banned words (recreate by hand so the session never wrote them), ask the model to append one clean sentence. Expect: no feedback and no gate. Alerts outside the lines the edit added are filtered, and the gate only tracks errors this session's edits produced.

**9. The allow flow.** Run `/just-say-so:allow "robust regression"`. Expect: no permission prompt, because the skill pre-approves its own CLI call. If a prompt appears, `${CLAUDE_PLUGIN_ROOT}` did not expand in frontmatter. Note it. With no `.vale.ini` in the scratch repo, the term goes to `.just-say-so.json` → `bannedCheck.allowPhrases`. Then ask for a file containing `We fit a robust regression model.` and expect no alert. Ask for `a robust pipeline` and expect an alert.

**9b. The allow flow (vocabulary route).** Create a `.vale.ini` with `StylesPath = styles` and `Vocab = Test`, run `/just-say-so:allow "blast radius"`. Ground truth: `styles/config/vocabularies/Test/accept.txt` gains the line.

**10. The ask gate.** Say: "Set reply.mode to off in .just-say-so.json." Expect: a confirmation prompt citing the policy file before the edit is written, even if you're in auto-accept mode. Approve it, then verify the file. Repeat with "add a rule to .vale.ini" and with the vocabulary `accept.txt`, and expect the same prompt.

## Phase C: token mode

Removed in 0.9.0: there is no token mode. Run `/clear`.

**11. Token threshold.** Removed in 0.9.0. Prompt 1 sets the baseline (silent). Then ask the model to read a few large files to grow context past 3,000 tokens, and send another prompt. Expect the reminder. Ground truth: state file's `contextAtLastReminder` jumps to the new context size.

## Phase D: subagents (resolves an open question)

**12. Subagent briefing.** Ask: "Use a subagent to write summary.md describing this folder." Ground truth: grep the *subagent's* transcript (the additional `.jsonl` files in the same project directory) for the reminder heading. **This is the live test of whether `SubagentStart` honors `additionalContext`. The docs truncate before its output schema.** If the heading is absent from the subagent transcript, the injection is ignored and we fall back to briefing on first `PreToolUse`.

**13. Subagent enforcement.** Ask a subagent to write a file containing `seamless synergy`. Expect: the subagent receives the Vale alert facts after its write (grep the subagent transcript for `just-say-so: Vale reports`). **This is the live test of whether a subagent's `PostToolUse` event reports the main session id.** If it does, the state file gains the written path under `valeFiles`, and in block mode the main turn's Stop gate blocks until the file is fixed. If subagent events report their own session id, the gate misses subagent-written files. Record that as a gap.

## Phase E: chat reply check

Edit `.just-say-so.json`: add `"reply": { "mode": "block" }`.

**14. Reply check, block.** Say: `Reply with exactly this sentence: we leverage synergy.` Expect: the model finishes, the Stop hook bounces the reply with the Vale alerts, and the model continues with a rewrite. If the rewrite still has the same alerts, the hook reports once (`not blocking again`) instead of looping. Note the UX. That experience is the reason `block` is not the default.

**15. Warn report (0.5.0).** Removed in 0.9.0. Switch `outputCheck.mode` to `"warn"` with `"deliver": "next-reminder"`, set `reminder.mode` to `"prompts"` with `everyPrompts` at 3, and repeat. Expect: the reply stands, nothing prints, and the next prompt gets nothing either. On the third prompt the reminder fires with the report under the rules (transcript grep: `Recent replies broke these rules`), naming `JustSaySo.Leverage "leverage"` and `JustSaySo.Buzzwords "synergy"` with counts. With ai-tells loaded in `[*.reply]`, `leverage` appears once, under the JustSaySo rule (0.5.1, issue #1). The session state file (`~/.local/state/just-say-so/sessions/<id>.json` or `$CLAUDE_PLUGIN_DATA/state/...`) shows `replyAlerts` filled before the reminder and `{}` after.

**15a. The model leaves the report unmentioned (0.5.0, resolves an open question).** Continue from 15. On the prompt that includes the report, ask an unrelated question. Expect: the answer neither acknowledges the report ("Noted, I'll avoid...") nor revises or repeats the earlier reply. Record the exact wording if it does; the instruction text is `replyReportInstruction` in `rules/messages.json`, and the fix is there, not in code.

**15b. Report rides compaction.** Continue from 15 with counts waiting (stay under the interval). Run `/compact`. Expect: the post-compaction injection includes the report (transcript grep as above), and the state file shows `replyAlerts: {}` afterwards.

**15c. Idle notice.** Removed in 0.9.0. Set `reminder.mode` to `"off"` with `outputCheck.mode` still `"warn"` and `deliver` still `"next-reminder"`. Start a session. Expect one system line: `The reply check is idle.` A flagged reply then records nothing (state file stays `replyAlerts: {}`).

**15d. Next-prompt delivery (0.6.0, the default).** Remove `deliver`, `reminder.mode`, and `everyPrompts` so all fall back to their defaults (`next-prompt`, `prompts`, 20). Say: `Reply with exactly this sentence: we leverage synergy.` Expect: the reply stands and nothing prints. Send any prompt. Expect: that prompt includes the rules and the report (transcript grep: `Recent replies broke these rules`), and the state file shows `replyAlerts: {}` and `promptAtLastReminder` equal to `promptCount`. Send three more clean prompts. Expect: no injection on any of them.

**15e. Report resets the interval (0.6.0).** Removed in 0.9.0. Set `reminder.mode` to `"prompts"` with `everyPrompts` at 3, keep `deliver` at its default. Send two clean prompts, then the banned sentence from 15d. The next prompt (the third) fires with the report. Expect: no injection on prompts four and five, and prompt six gets the injection on the interval.

## Phase E2: rejected replies (0.7.0)

Defaults in `.just-say-so.json` (remove the `reply` override).

**16. Restate with a reason.** Say: `Reply with exactly this sentence: we leverage synergy to empower teams.` Then run `/just-say-so:restate too much jargon`. Expect: the reply is the rewrite alone. It contains no apology and does not mention the rules. Ground truth: `rejections.jsonl` in the state directory (`$CLAUDE_PLUGIN_DATA/state/` or `~/.local/state/just-say-so/`) has one new line. Its `rejected.text` is the banned sentence verbatim, `reason` is `too much jargon`, `rejected.alerts` names `leverage`, `synergy`, and `empower`, and `rewrite.text` is the model's second reply. The state file for the session shows `pendingRewrite: null` and `promptAtLastReminder` equal to `promptCount`.

**16a. Restate without a reason.** Repeat with `/just-say-so:restate` alone. Expect: the record's `reason` is `null`.

**16b. No double injection.** Removed in 0.9.0. Set `reminder.everyPrompts` to 2. Send one clean prompt, then the banned sentence, then `/just-say-so:restate`. Expect: the restate prompt includes the skill body with the rules but no `hook_additional_context` record from the prompt hook (transcript grep for the reminder heading finds it once, inside the skill expansion). The next prompt includes the reply report for the rewrite only when that rewrite broke a rule.

**16c. Wrong answer is not a restate.** Ask a factual question, get a correct answer, and run `/just-say-so:restate` anyway. Expect: the rewrite keeps every fact. This confirms the skill body's instruction. The README tells users to correct wrong answers in an ordinary prompt.

## Phase E3: events log (0.8.0)

Defaults in `.just-say-so.json` (remove `events` overrides). The log is `events.jsonl` in the state directory. `tail -f` it in a second terminal.

**17. One session, every event type.** Start a fresh session. Expect: a `session` line with `source: "startup"`, `vale: true`, and the config snapshot, then a `reminder` line with `trigger: "session"` and `promptIndex: 0`. Send a clean prompt. Expect: a `reply` line with `outcome: "pass"`, `promptIndex: 1`, `sinceReminder: 1`, `alerts: []`, and the model id. Say: `Reply with exactly this sentence: we leverage synergy.` Expect: a `reply` line whose `alerts` names `JustSaySo.Buzzwords` with `match` entries for `leverage` and `synergy`. Send any prompt. Expect: a `reminder` line with `trigger: "report"` and `withReport: true` (the default delivers the report on the next prompt), and `sinceReminder` on the following `reply` line is 0.

**17a. Restate.** Repeat the banned sentence and run `/just-say-so:restate jargon`. Expect: a `restate` line with `reasonGiven: true`, `sinceReminder` equal to the distance from the last reminder, and `record` matching the new id in `rejections.jsonl`. Then a `reminder` line with `trigger: "restate"`, then a `reply` line for the rewrite with `rewriteOf` set to the same id. The rejection record includes `prompt` (the sentence request), `model`, and `sinceReminder`.

**17b. Allow.** Run `/just-say-so:allow "robust regression"`. Expect: an `allow` line with `method`, `list` (null on the vocabulary route), and `added: true`. `session` is null unless the harness exported `CLAUDE_SESSION_ID` to the command.

**17c. Block cycles.** Set `reply.mode` to `block`, request the banned sentence. Expect: one `reply` line with `outcome: "block"` per blocked attempt, then a final `pass` or `waived` line for the same `promptIndex`.

**17d. Checks off.** Set `reply.mode` and `files.mode` to `off`. Send the banned sentence. Expect: the prompt hook injects nothing and the Stop hook does not block. The `reply` line still includes the alerts, because the log lints on its own. Set `events.mode` to `off` and repeat. Expect: no new lines, and no `vale` process in the Stop hook's timing.

**17e. Compact.** Run `/compact`. Expect: a `session` line with `source: "compact"` and a `reminder` line at `promptIndex: 0`.

## Phase F: published text via gh (0.2.0)

Edit `.just-say-so.json`: `{ "publish": { "gh": true } }`. The scratch repo has no GitHub remote, so even a command that slips past the gate cannot publish anything. It fails on "no such remote" instead. Preflight: `claude --version` must be ≥ 2.1.85 for the `if` filter in the hook wiring to apply; on older versions the hook runs on every Bash command, which changes the cost, not the outcome, of these scenarios. (MCP coverage needs a connected server. Verify it opportunistically in a real project.)

**16. Plain-form control.** Ask: "Run this command: `gh pr comment 42 --body \"We leverage robust synergy.\"`". Expect: DENIED before execution, with `gh pr comment` named in the violation list. Ground truth: `claude --debug` shows the pre-gate running for the Bash command. The transcript contains `just-say-so: Vale alerts in text published by gh pr comment`. This control must pass before scenario 17 means anything. If it fails, the addon config or the hook wiring is broken, not the heredoc handling.

**17. Heredoc-piped form.** Ask the model to run:

```
cat <<'EOF' | gh pr comment 42 --body-file -
We leverage robust synergy.
EOF
```

**This is the live test of whether the harness's `if: "Bash(gh *)"` filter matches a pipeline whose gh command follows a heredoc. The docs say subcommands in pipelines are parsed, but never show a heredoc example.** Expect: DENIED, same as the control. Once the hook spawns, the in-hook trigger matches `gh pr comment` anywhere in the command text, so the only unknown is whether the hook spawns at all. Ground truth: `claude --debug` shows the pre-gate running for this Bash command. If the deny is absent AND the debug output shows no hook execution, the `if` filter dropped the heredoc form: record it, and the fix is choosing between removing `if` from the Bash entry in `hooks.json` (every Bash call pays the spawn, coverage complete) or documenting the heredoc form as a known gap in the README next to `--body-file`.

## Phase G: Vale engine specifics (0.3.0)

**18. Missing binary notice.** Make `vale` unreachable by renaming it (`mv "$(command -v vale)" "$(command -v vale)_off"`). A stripped PATH also loses node on a Homebrew machine, so renaming is the reliable route. Start a session. Expect one system line at session start naming the missing binary; the checks then skip every write, and nothing breaks. Rename the binary back afterwards.

**19. Project `.vale.ini` wins.** Drop a `.vale.ini` in the scratch repo with `MinAlertLevel = suggestion`, a style of your choice, and a `[*.reply]` section. Ground truth: alerts in check feedback now name your styles' rules, not only `JustSaySo.*`.

**19a. Dead chat section notice (0.9.0).** Add a `[*.chat.md]` section to that `.vale.ini` and start a session. Expect one system line naming the section and the rename. Remove the JustSaySo package line (or the `[formats]` lines) and start again. Expect the second notice about the missing mapping. With the package synced and no chat section, expect no notice.

## Phase H: the rules manifest (0.10.0)

**20. Config-adjusted reminder.** In the scratch repo's `.vale.ini`, set `JustSaySo.Intensifiers = NO` under `[*]` and add a style of your own with one error-level rule that no shipped bullet names. Start a session. Ground truth: the injected rules (transcript grep `## Communication rules — reminder`) have no "Empty intensifiers" bullet, and end with `This project also enforces these Vale rules at error level:` naming your rule. Remove the `NO` line, start again: the bullet is back.

**20a. Extra rules.** Set `rules.extra` to a JSON file with one section and one rule that has a `short` text. Start a session. Expect the rule as the last bullet of the reminder, and in `/just-say-so:rules` under its own heading.

## Phase I: init and doctor (0.11.0)

**21. Doctor.** In the scratch repo run `/just-say-so:doctor`. Expect the report in a code block, one line per target, and the warnings the setup deserves (a fresh scratch repo with no `.vale.ini` gets the fallback warning).

**21a. Init.** Run `/just-say-so:init --gh --reply block`. Expect: the skill runs the CLI without a permission prompt, `.vale.ini` and `styles/` appear, `.just-say-so.json` holds the two settings, and the doctor report at the end has no warnings. Run it again: every line says the setup is current. Run `/just-say-so:allow "robust regression"`: the term is written to `styles/config/vocabularies/Project/accept.txt`.

## Phase J: publish fields and the Artifact gate (0.12.0)

**22. Artifact gate.** Write `report.html` containing `pure synergy` and ask the model to publish it as an artifact. Expect: the call is denied before anything is published, the reason names `Artifact` and the alert, and the transcript shows the lint under `artifact.report.html`. Ask it to list artifacts: no hook output. This is the live check of the `Artifact` tool name in PreToolUse events. **Passed 2026-10-27 on plugin 0.12.0:** the publish came back as `PreToolUse:Artifact hook error` with both alerts, and the listing ran with no hook output.

**22a. MCP fields.** With `publish.mcp` naming a Jira or Confluence tool, ask the model to create a page whose title is one word and whose body is `pure synergy`. Expect: the deny names the body's JSON path and not the title, and the lint names are `mcp.<server>.<tool>.<field>.publish`.

## Phase K: drafting bullets (0.13.0)

**23. Draft.** In a scratch repo with ai-tells synced and two of its rules set to `error` in `[*]`, run `/just-say-so:draft`. Expect: the command output lists the two rules with their messages, the model prints one JSON fragment with bullets whose `vale` lists hold those exact ids, and nothing is written. Save the fragment, set `rules.extra`, start a session: the reminder includes the new bullets and the closing line no longer names those rules. Run `/just-say-so:doctor` with a misspelled id in the fragment: the warning names it.

## Phase L: the summary (0.14.0)

**24. Summary.** After a session with a flagged reply, a `/just-say-so:restate`, and a `/just-say-so:allow`, run `/just-say-so:summary`. Expect: turns and attempts counted from the Stop events, one rejection that joins to a turn, the rule and term from the flagged reply under "Rules with an error", the allow under "Allows", and no recommendation. Run it again with `--since 1d` and with `--project` set to another path: the second shows no records.

## Phase M: reason tags (0.15.0)

**25. Tags.** Run `/just-say-so:restate #undefined-term what is a "pin"?` after a reply that used a term without defining it. Expect: the rewrite defines or replaces the term. The record in `rejections.jsonl` has `reason` as typed and `tags: ["undefined-term"]`, and the `restate` event includes the tag. Run `/just-say-so:summary`: the Tags section lists `undefined-term` under "what the rules do not cover yet". Restate once more with `#end-with-fact`: the summary says that tag is covered by a bullet backed by ai-tells rules and whether they matched.

## Recording results

Mark each scenario pass or fail with the ground-truth evidence.

Scenario texts above were rewritten 2026-09-23 for the Vale engine (0.3.0): the file check moved to PostToolUse, block mode moved to the Stop gate, and the message strings changed. The results below predate that and record the 0.1.x/0.2.x behavior they tested.

## Results: 2026-09-20 run (plugin 0.1.1)

12 clean passes. Scenarios 12 (subagent briefing) and 9 (skill frontmatter expansion) resolved their open questions affirmatively. Three findings, all fixed in 0.1.2:

1. **Test 8 partial.** Edits that append by anchor-replacement copy the old line into `new_string`, so the gate matched pre-existing banned words. Fixed: the checker now diffs `old_string`/`new_string` and scans only the added text, widened to word boundaries.
2. **Test 13 fail.** Backgrounded-subagent events had a `cwd` outside the project. Config discovery found nothing and block mode silently degraded to warn. Fixed: config discovery anchors on the written file's own directory, and relative globs measure from the config file's directory.
3. **Test 14 partial.** Stop events had the same bad `cwd`. The chat check silently loaded no config. Fixed: the prompt hook records the project directory in session state, and the Stop hook falls back to it. Residual: a Stop that runs before any prompt in a session has no recorded directory.
