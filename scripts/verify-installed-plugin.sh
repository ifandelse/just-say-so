#!/usr/bin/env bash
# Regression sweep of the INSTALLED just-say-so plugin (the copy in Claude
# Code's plugin cache, not this repo). Replays event JSON through every hook
# script and the allow CLI, asserting on the plugin-logic layer.
#
# What this cannot cover: the delivery layer — whether the harness fires the
# hooks, shows dialogs, and lands injected context. docs/manual-tests.md
# stays the plan for that.
set -u

CACHE="$HOME/.claude/plugins/cache/just-say-so/just-say-so"
if [ ! -d "$CACHE" ]; then
  echo "No installed plugin found at $CACHE" >&2
  exit 1
fi
VERSION=$(ls "$CACHE" | sort -V | tail -1)
PLUGIN="$CACHE/$VERSION"
echo "Testing installed plugin: $VERSION ($PLUGIN)"

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
PASS=0
FAIL=0

# Isolated environment: state and global config never touch the real ones.
new_env() { # $1 = name; sets W (project dir), STATE, GLOBAL
  W="$ROOT/$1"
  STATE="$ROOT/$1-state"
  GLOBAL="$ROOT/$1-global.json" # never created unless a test writes it
  mkdir -p "$W"
}

run_hook() { # $1 = script name, $2 = json; result in OUT/CODE
  OUT=$(printf '%s' "$2" | JUST_SAY_SO_STATE_DIR="$STATE" JUST_SAY_SO_CONFIG="$GLOBAL" node "$PLUGIN/src/hooks/$1" 2>/dev/null)
  CODE=$?
}

check() { # $1 = label, $2 = condition result (0 = pass)
  if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "  ok: $1"
  else FAIL=$((FAIL + 1)); echo "  FAIL: $1  (output: ${OUT:0:160})"; fi
}
contains() { case "$OUT" in *"$1"*) return 0;; *) return 1;; esac; }
silent() { [ -z "$OUT" ]; }

echo '— session start'
new_env s1
run_hook session-start.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"startup\"}"
contains '## Communication rules — reminder'; check 'startup injects the condensed rules' $?
run_hook session-start.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"compact\"}"
contains 'SessionStart'; check 'compact injects too' $?

echo '— prompt-interval reminder (default: every 5)'
new_env s2
ALL_SILENT=0
for i in 1 2 3 4; do
  run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  silent || ALL_SILENT=1
done
check 'prompts 1-4 stay silent' $ALL_SILENT
run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
contains '## Communication rules — reminder'; check 'prompt 5 fires the reminder' $?

echo '— banned check, warn default'
new_env s3
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"We leverage robust synergy.\"}}"
contains 'The call was allowed'; check 'warn mode allows with feedback' $?
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/package.json\",\"content\":\"robust\"}}"
silent; check 'default excludes skip package.json' $?

echo '— banned check, block mode (project config)'
new_env s4
printf '%s' '{"bannedCheck":{"mode":"block","exclude":["docs/**"],"allowPhrases":["robust regression"],"disableWords":["synergy"]}}' > "$W/.just-say-so.json"
mkdir -p "$W/docs"
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"a robust plan\"}}"
contains '"permissionDecision":"deny"' && contains '/just-say-so:allow'; check 'block denies and suggests the allow skill' $?
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/stats.md\",\"content\":\"a robust regression model\"}}"
silent; check 'allowPhrases neutralizes the collocation' $?
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"pure synergy\"}}"
silent; check 'disableWords removes the term' $?

echo '— live-run fix: Edit scans only added text'
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"old_string\":\"We leverage robust text.\",\"new_string\":\"We leverage robust text.\\nThe tests pass.\"}}"
silent; check 'anchor-append with banned old text passes' $?
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"old_string\":\"a ro plan\",\"new_string\":\"a robust plan\"}}"
contains '\"robust\" ×1'; check 'word completed across the cut still flags' $?

echo '— live-run fix: config anchors on the file, not the event cwd'
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"/nope/elsewhere\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"a robust plan\"}}"
contains '"permissionDecision":"deny"'; check 'wrong cwd still finds project block mode' $?
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"/nope/elsewhere\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/docs/x.md\",\"content\":\"a robust plan\"}}"
silent; check 'relative glob measures from the project root' $?

echo '— ask gate on the plugin config'
run_hook check-banned.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/.just-say-so.json\",\"content\":\"{}\"}}"
contains '"permissionDecision":"ask"'; check 'config edits ask for confirmation' $?

echo '— token mode'
new_env s5
printf '%s' '{"reminder":{"mode":"tokens","everyTokens":100}}' > "$W/.just-say-so.json"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":1000}}}' > "$ROOT/t1.jsonl"
printf '%s\n' '{"type":"assistant","message":{"usage":{"input_tokens":1300}}}' > "$ROOT/t2.jsonl"
run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"transcript_path\":\"$ROOT/t1.jsonl\"}"
silent; check 'first sight sets the baseline silently' $?
run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"transcript_path\":\"$ROOT/t2.jsonl\"}"
contains '## Communication rules — reminder'; check 'growth past the threshold fires' $?

echo '— subagent briefing'
new_env s6
run_hook subagent-start.js "{\"session_id\":\"S\",\"agent_id\":\"A\",\"agent_type\":\"Explore\",\"cwd\":\"$W\"}"
contains '"hookEventName":"SubagentStart"'; check 'subagents get briefed at spawn' $?
printf '%s' '{"reminder":{"onSubagentStart":false}}' > "$W/.just-say-so.json"
run_hook subagent-start.js "{\"session_id\":\"S\",\"agent_id\":\"A\",\"agent_type\":\"Explore\",\"cwd\":\"$W\"}"
silent; check 'the switch turns the briefing off' $?

echo '— chat reply check (Stop)'
new_env s7
printf '%s' '{"outputCheck":{"mode":"block"},"bannedCheck":{"disableWords":["synergy"]}}' > "$W/.just-say-so.json"
run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"last_assistant_message\":\"we leverage synergy\"}"
contains '"decision":"block"' && contains 'leverage' && ! contains 'synergy'; check 'block flags leverage, honors disableWords' $?
run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"stop_hook_active\":true,\"last_assistant_message\":\"we leverage this\"}"
silent; check 'loop guard skips the rewrite pass' $?

echo '— live-run fix: Stop falls back to the recorded project dir'
run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"/nope/elsewhere\",\"last_assistant_message\":\"we leverage this\"}"
contains '"decision":"block"'; check 'wrong Stop cwd uses the recorded dir' $?

echo '— warn queue'
new_env s8
printf '%s' '{"outputCheck":{"mode":"warn"}}' > "$W/.just-say-so.json"
run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"last_assistant_message\":\"we leverage this\"}"
silent; check 'warn stays silent at Stop' $?
run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
contains 'your last reply contains banned terms'; check 'the next prompt delivers the queued note' $?

echo '— allow CLI'
new_env s9
(cd "$W" && node "$PLUGIN/src/cli/allow.js" robust >/dev/null 2>&1 && node "$PLUGIN/src/cli/allow.js" robust regression >/dev/null 2>&1)
OUT=$(cat "$W/.just-say-so.json")
contains '"disableWords"' && contains '"robust"' && contains '"allowPhrases"' && contains '"robust regression"'; check 'CLI routes words and phrases to the right lists' $?
OUT=$(cd "$W" && node "$PLUGIN/src/cli/allow.js" ROBUST 2>&1)
contains 'already'; check 'CLI dedupes case-insensitively' $?

echo '— resilience'
GARBAGE_OK=0
for s in remind.js check-banned.js session-start.js subagent-start.js check-output.js; do
  OUT=$(printf 'not json' | JUST_SAY_SO_STATE_DIR="$STATE" JUST_SAY_SO_CONFIG="$GLOBAL" node "$PLUGIN/src/hooks/$s" 2>/dev/null)
  [ $? -eq 0 ] && [ -z "$OUT" ] || GARBAGE_OK=1
done
check 'all five scripts exit 0 silently on garbage stdin' $GARBAGE_OK

echo ''
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
