#!/usr/bin/env bash
# Regression sweep of the INSTALLED just-say-so plugin (the copy in Claude
# Code's plugin cache, not this repo). Replays event JSON through every hook
# script and the allow CLI, asserting on the plugin-logic layer.
#
# What this cannot cover: the delivery layer — whether the harness fires the
# hooks, shows dialogs, and lands injected context. docs/manual-tests.md
# stays the plan for that.
#
# The Vale-backed checks need the real `vale` binary on PATH; without it those
# scenarios are skipped and reported.
set -u

CACHE="$HOME/.claude/plugins/cache/just-say-so/just-say-so"
if [ ! -d "$CACHE" ]; then
  echo "No installed plugin found at $CACHE" >&2
  exit 1
fi
VERSION=$(ls "$CACHE" | sort -V | tail -1)
PLUGIN="$CACHE/$VERSION"
echo "Testing installed plugin: $VERSION ($PLUGIN)"

HAVE_VALE=0
vale ls-dirs >/dev/null 2>&1 && HAVE_VALE=1
[ "$HAVE_VALE" -eq 1 ] || echo "NOTE: vale not usable on PATH — Vale-backed scenarios will be skipped"

NODE_BIN=$(command -v node)
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
PASS=0
FAIL=0
SKIP=0

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
skip() { SKIP=$((SKIP + 1)); echo "  skip: $1 (no vale)"; }
contains() { case "$OUT" in *"$1"*) return 0;; *) return 1;; esac; }
silent() { [ -z "$OUT" ]; }

echo '— session start'
new_env s1
run_hook session-start.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"startup\"}"
contains '## Communication rules — reminder'; check 'startup injects the condensed rules' $?
run_hook session-start.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"compact\"}"
contains 'SessionStart'; check 'compact injects too' $?
OUT=$(printf '%s' "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"startup\"}" | JUST_SAY_SO_STATE_DIR="$STATE" JUST_SAY_SO_CONFIG="$GLOBAL" PATH=/usr/bin:/bin "$NODE_BIN" "$PLUGIN/src/hooks/session-start.js" 2>/dev/null)
contains 'vale binary is missing'; check 'a stripped PATH earns the missing-vale notice' $?

echo '— prompts without a violation'
new_env s2
ALL_SILENT=0
for i in 1 2 3 4 5; do
  run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  silent || ALL_SILENT=1
done
check 'five clean prompts stay silent (no interval reminder)' $ALL_SILENT
printf '%s' '{"reminder":{"everyPrompts":2}}' > "$W/.just-say-so.json"
run_hook session-start.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"source\":\"startup\"}"
contains 'sets reminder, which 0.9.0 no longer reads'; check 'a 0.8.x key earns the legacy-config notice' $?

echo '— pre-gate: policy-file confirmations'
new_env s3
run_hook pre-gate.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/.just-say-so.json\",\"content\":\"{}\"}}"
contains '"permissionDecision":"ask"'; check 'plugin config edits ask for confirmation' $?
run_hook pre-gate.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/.vale.ini\",\"content\":\"\"}}"
contains '"permissionDecision":"ask"'; check 'Vale config edits ask too' $?
run_hook pre-gate.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"We leverage synergy.\"}}"
silent; check 'ordinary file writes pass the pre-gate untouched' $?

echo '— pre-gate: gh publishing'
if [ "$HAVE_VALE" -eq 1 ]; then
  new_env s4
  printf '%s' '{"publish":{"gh":true}}' > "$W/.just-say-so.json"
  run_hook pre-gate.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr comment 42 --body \\\"pure synergy\\\"\"}}"
  contains '"permissionDecision":"deny"' && contains '/just-say-so:allow'; check 'block denies before publication and suggests the allow skill' $?
  printf '%s' '{"publish":{"mode":"warn","gh":true}}' > "$W/.just-say-so.json"
  run_hook pre-gate.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr comment 42 --body \\\"pure synergy\\\"\"}}"
  contains 'additionalContext' && contains 'synergy'; check 'warn advises and lets the call proceed' $?
else
  skip 'gh deny in block mode'; skip 'gh warn advice'
fi

echo '— post-write check (check-vale)'
if [ "$HAVE_VALE" -eq 1 ]; then
  new_env s5
  printf 'We leverage synergy.\n' > "$W/notes.md"
  run_hook check-vale.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"content\":\"x\"}}"
  contains '"hookEventName":"PostToolUse"' && contains 'leverage'; check 'a banned Write gets the facts, not a block' $?
  printf '{ "dependencies": { "robust": "^1.0.0" } }\n' > "$W/package.json"
  run_hook check-vale.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/package.json\",\"content\":\"x\"}}"
  silent; check 'the fallback config exempts package.json' $?
  printf 'We leverage old text.\nThe tests pass.\n' > "$W/notes.md"
  run_hook check-vale.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$W/notes.md\",\"old_string\":\"end\",\"new_string\":\"The tests pass.\"}}"
  silent; check 'an Edit answers only for its own added lines' $?
  printf 'StylesPath = styles\nVocab = Team\nPackages = %s/JustSaySo.zip\n\n[*]\nBasedOnStyles = JustSaySo\n' "$PLUGIN" > "$W/.vale.ini"
  mkdir -p "$W/styles/config/vocabularies/Team"
  printf 'robust regression\n' > "$W/styles/config/vocabularies/Team/accept.txt"
  cp -R "$PLUGIN/styles/JustSaySo" "$W/styles/JustSaySo"
  printf 'a robust regression model\n' > "$W/stats.md"
  run_hook check-vale.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/stats.md\",\"content\":\"x\"}}"
  silent; check 'a vocabulary entry neutralizes the collocation' $?
else
  for label in 'post-write facts' 'package.json exemption' 'edit-scope' 'vocabulary on Vale alerts'; do skip "$label"; done
fi

echo '— Stop: session gate (files block)'
if [ "$HAVE_VALE" -eq 1 ]; then
  new_env s6
  printf '%s' '{"files":{"mode":"block"}}' > "$W/.just-say-so.json"
  printf 'pure synergy\n' > "$W/doc.md"
  run_hook check-vale.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$W/doc.md\",\"content\":\"x\"}}"
  run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  contains '"decision":"block"' && contains 'alerts remain in files this session wrote'; check 'outstanding errors block the turn' $?
  run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"stop_hook_active\":true}"
  contains 'not blocking again'; check 'an unchanged alert set stands the gate down' $?
  printf 'clean text\n' > "$W/doc.md"
  run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  silent; check 'fixed errors clear the gate' $?
else
  for label in 'gate blocks' 'gate stands down' 'gate clears'; do skip "$label"; done
fi

echo '— Stop: chat reply check'
if [ "$HAVE_VALE" -eq 1 ]; then
  new_env s7
  printf '%s' '{"reply":{"mode":"block"}}' > "$W/.just-say-so.json"
  run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"last_assistant_message\":\"we leverage synergy\"}"
  contains '"decision":"block"' && contains 'leverage' && contains 'synergy'; check 'block flags both terms' $?
  new_env s8
  printf '%s' '{"reply":{"mode":"warn"}}' > "$W/.just-say-so.json"
  run_hook check-output.js "{\"session_id\":\"S\",\"cwd\":\"$W\",\"last_assistant_message\":\"we leverage this\"}"
  [ -z "$OUT" ]; check 'warn keeps stdout empty at Stop' $?
  run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  contains 'Recent replies broke these rules' && contains 'Leverage \"leverage\" (1)'; check 'the next prompt carries the rules and the reply report' $?
  run_hook remind.js "{\"session_id\":\"S\",\"cwd\":\"$W\"}"
  ! contains 'Recent replies broke these rules'; check 'the report clears after delivery' $?
else
  for label in 'reply block' 'warn stdout empty' 'warn report delivery' 'warn report clears'; do skip "$label"; done
fi

echo '— subagent briefing'
new_env s10
run_hook subagent-start.js "{\"session_id\":\"S\",\"agent_id\":\"A\",\"agent_type\":\"Explore\",\"cwd\":\"$W\"}"
contains '"hookEventName":"SubagentStart"'; check 'subagents get briefed at spawn' $?
printf '%s' '{"rules":{"onSubagentStart":false}}' > "$W/.just-say-so.json"
run_hook subagent-start.js "{\"session_id\":\"S\",\"agent_id\":\"A\",\"agent_type\":\"Explore\",\"cwd\":\"$W\"}"
silent; check 'the switch turns the briefing off' $?

echo '— allow CLI'
new_env s11
OUT=$(cd "$W" && node "$PLUGIN/src/cli/allow.js" robust 2>&1)
contains 'no .vale.ini above'; check 'without a .vale.ini the CLI refuses and says what to add' $?
printf 'StylesPath = styles\n' > "$W/.vale.ini"
(cd "$W" && node "$PLUGIN/src/cli/allow.js" robust >/dev/null 2>&1 && node "$PLUGIN/src/cli/allow.js" robust regression >/dev/null 2>&1)
OUT=$(cat "$W/.vale.ini"; cat "$W/styles/config/vocabularies/Project/accept.txt" 2>/dev/null)
contains 'Vocab = Project' && contains 'robust regression'; check 'the CLI adds Vocab to the ini and both terms to accept.txt' $?
OUT=$(cd "$W" && node "$PLUGIN/src/cli/allow.js" ROBUST 2>&1)
contains 'already'; check 'CLI dedupes case-insensitively' $?

echo '— resilience'
GARBAGE_OK=0
for s in remind.js pre-gate.js check-vale.js session-start.js subagent-start.js check-output.js; do
  OUT=$(printf 'not json' | JUST_SAY_SO_STATE_DIR="$STATE" JUST_SAY_SO_CONFIG="$GLOBAL" node "$PLUGIN/src/hooks/$s" 2>/dev/null)
  [ $? -eq 0 ] && [ -z "$OUT" ] || GARBAGE_OK=1
done
check 'all six scripts exit 0 silently on garbage stdin' $GARBAGE_OK

echo ''
echo "passed: $PASS  failed: $FAIL  skipped: $SKIP"
[ "$FAIL" -eq 0 ]
