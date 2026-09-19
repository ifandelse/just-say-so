---
name: allow
description: Permit a term the banned-word gate flagged — adds single words to disableWords and collocations to allowPhrases in this project's .just-say-so.json.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" *)
---

The user wants to permit a term that the just-say-so banned-word gate flagged as a precise domain term in this project. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/src/cli/allow.js" $ARGUMENTS
```

Report the command's output in one sentence. If the user gave no term, ask which term to allow before running anything.
